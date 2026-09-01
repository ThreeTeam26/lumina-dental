"""
Booking business logic – validation, queue assignment, arrival & payment
state transitions.

All queue numbers, waiting-time estimates, payment state and arrival state
are computed/validated here on the backend — the frontend only ever
displays what these functions return.
"""

import re
from datetime import date, datetime, timedelta
from sqlalchemy.orm import Session
from fastapi import HTTPException, status

from core.crud.booking import (
    create_booking_with_queue_number,
    create_list_only_consultation,
    reschedule_booking_with_queue_number,
    find_active_booking_for_phone,
    _phones_match,
    count_active_bookings_for_date,
    get_max_queue_number_for_date,
    count_patients_ahead,
    get_currently_serving,
    get_booking as crud_get,
    get_all_bookings as crud_all,
    get_bookings_for_date,
    update_booking_status as crud_update_status,
    set_arrival as crud_set_arrival,
    set_consultation_hint_dismissed as crud_set_hint,
    set_payment_paid as crud_set_payment_paid,
    set_extra_charge as crud_set_extra_charge,
    set_medical_record as crud_set_medical_record,
    get_bookings_by_phone as crud_get_by_phone,
    delete_booking as crud_delete,
)
from core.crud.booking import STILL_WAITING_STATUSES
from core.crud.setting import get_consultation_fee
from core.crud.branch import get_branch
from core.database import Booking, BookingStatus, PaymentMethod, PaymentStatus, ServiceType, User
from core.clinic_schedule import get_working_hours, is_working_day, is_within_working_hours, branch_working_hours
from core.config import settings
from schemas.booking import (
    BookingCreate,
    BookingStatusEnum,
    BookingStatusUpdate,
    ExtraChargeUpdate,
    MedicalRecordUpdate,
    ServiceTypeEnum,
)

# Treatments must match the frontend constants
VALID_TREATMENTS = {
    "Cosmetic Dentistry",
    "Dental Implants",
    "Teeth Whitening",
    "Orthodontics",
    "General Dentistry",
    "Pediatric Dentistry",
}

# The `treatment` label stored for consultation bookings (they reuse the same
# form and queue system — the service type is what distinguishes them).
CONSULTATION_LABEL = "Consultation"

WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def _parse_date(raw: str) -> date:
    try:
        return date.fromisoformat(raw)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Date must be in YYYY-MM-DD format.",
        )


def _estimate_window(booking_date: date, patients_ahead: int, now: datetime | None = None, schedule=None):
    """(start, end) estimate for reaching the front of the queue.

    Baselines off clinic opening time, except for same-day bookings made
    after opening — those baseline off "now" so the estimate reflects
    today's actual queue progress instead of a time that's already passed.

    `schedule` scopes this to one branch's working hours (see
    core/clinic_schedule.py's branch_working_hours()); omit it for the
    clinic-wide default.
    """
    hours = get_working_hours(booking_date, schedule)
    if hours is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"The clinic is closed on {WEEKDAY_NAMES[booking_date.weekday()]}s. Please choose a working day.",
        )
    opens, _closes = hours
    open_dt = datetime.combine(booking_date, opens)
    baseline = open_dt
    if now is not None and booking_date == now.date() and now > open_dt:
        baseline = now
    start = baseline + timedelta(minutes=patients_ahead * settings.MIN_CONSULTATION_MINUTES)
    end = baseline + timedelta(minutes=patients_ahead * settings.MAX_CONSULTATION_MINUTES)
    return start, end


def get_availability(db: Session, date_str: str, branch_id: int | None = None):
    booking_date = _parse_date(date_str)
    schedule = branch_working_hours(get_branch(db, branch_id)) if branch_id is not None else None
    hours = get_working_hours(booking_date, schedule)
    today = date.today()

    if hours is None:
        return {
            "date": date_str,
            "is_working_day": False,
            "opens": None,
            "closes": None,
            "patients_booked": 0,
            "next_queue_number": None,
            "reason": f"The clinic is closed on {WEEKDAY_NAMES[booking_date.weekday()]}s.",
        }

    if booking_date < today:
        return {
            "date": date_str,
            "is_working_day": True,
            "opens": hours[0].strftime("%H:%M"),
            "closes": hours[1].strftime("%H:%M"),
            "patients_booked": 0,
            "next_queue_number": None,
            "reason": "This date is in the past.",
        }

    if (booking_date - today).days > settings.BOOKING_WINDOW_DAYS:
        return {
            "date": date_str,
            "is_working_day": True,
            "opens": hours[0].strftime("%H:%M"),
            "closes": hours[1].strftime("%H:%M"),
            "patients_booked": 0,
            "next_queue_number": None,
            "reason": f"Bookings can only be made up to {settings.BOOKING_WINDOW_DAYS} days in advance.",
        }

    patients_booked = count_active_bookings_for_date(db, date_str, branch_id)
    # The number an actual booking would be assigned right now (see
    # create_booking_with_queue_number) — based on the highest number ever
    # handed out that day, not the active count, so this preview never
    # promises a number that's already taken by an earlier cancelled booking.
    next_queue_number = get_max_queue_number_for_date(db, date_str, branch_id) + 1
    return {
        "date": date_str,
        "is_working_day": True,
        "opens": hours[0].strftime("%H:%M"),
        "closes": hours[1].strftime("%H:%M"),
        "patients_booked": patients_booked,
        "next_queue_number": next_queue_number,
        "reason": None,
    }


def _validate_booking_date(db: Session, date_str: str, branch_id: int | None, schedule) -> date:
    """Shared date validation for both new bookings and reschedules: not in the
    past, an open day at this branch, inside the booking window, and not past
    the day's capacity. Returns the parsed date; raises HTTPException otherwise."""
    booking_date = _parse_date(date_str)
    today = date.today()

    if booking_date < today:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Booking date cannot be in the past.",
        )
    if not is_working_day(booking_date, schedule):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"The clinic is closed on {WEEKDAY_NAMES[booking_date.weekday()]}s. Please choose a working day.",
        )
    if (booking_date - today).days > settings.BOOKING_WINDOW_DAYS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Bookings can only be made up to {settings.BOOKING_WINDOW_DAYS} days in advance.",
        )

    # Best-effort capacity check (soft — the authoritative uniqueness guarantee
    # is the retry loop + DB constraint in the CRUD layer).
    hours = get_working_hours(booking_date, schedule)
    close_dt = datetime.combine(booking_date, hours[1])
    if hours[1] < hours[0]:
        # Overnight schedule (e.g. 18:00-02:00): closing time is on the
        # following calendar day, not the same day as opening.
        close_dt += timedelta(days=1)
    now = datetime.now()
    projected_ahead = count_active_bookings_for_date(db, date_str, branch_id)
    projected_start, _ = _estimate_window(booking_date, projected_ahead, now, schedule)
    if projected_start >= close_dt:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{date_str} is fully booked for the day. Please choose another date.",
        )
    return booking_date


def validate_and_create_booking(db: Session, data: BookingCreate) -> Booking:
    """Validate business rules then persist a new booking with a
    backend-assigned, per-day-unique queue number."""
    # One active booking per patient (matched by phone): block a new booking
    # while this phone still has a pending/confirmed one — this is what stops a
    # patient going back to the home page and booking over and over. Completed
    # or cancelled bookings don't count, so they can book again afterwards.
    existing = find_active_booking_for_phone(db, data.phone)
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"This phone number already has an active booking "
                f"(queue #{existing.queue_number} on {existing.date}). "
                f"You can only have one active booking at a time — please wait "
                f"until it's completed, or cancel it, before booking again."
            ),
        )

    # A consultation reuses the whole booking flow — only its service type and
    # its stored `treatment` label differ. For treatment appointments we keep
    # enforcing the existing allow-list unchanged.
    is_consultation = data.service_type == ServiceTypeEnum.CONSULTATION
    if is_consultation:
        treatment_value = CONSULTATION_LABEL
        service_type = ServiceType.CONSULTATION
    else:
        if data.treatment not in VALID_TREATMENTS:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Unknown treatment '{data.treatment}'. Choose from: {', '.join(sorted(VALID_TREATMENTS))}",
            )
        treatment_value = data.treatment
        service_type = ServiceType.TREATMENT

    # A branch picked at booking time is stamped straight onto the booking —
    # its own working days/hours (if it's set any) gate which dates can be
    # picked, and its exam fee (or, for a consultation, its consultation
    # price) replaces the clinic-wide default whenever the branch has one set.
    branch = None
    if data.branch_id is not None:
        branch = get_branch(db, data.branch_id)
        if branch is None or not branch.is_active:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Selected branch was not found or is no longer active.",
            )
    schedule = branch_working_hours(branch)

    booking_date = _validate_booking_date(db, data.date, data.branch_id, schedule)
    now = datetime.now()

    def estimate_fn(patients_ahead: int):
        return _estimate_window(booking_date, patients_ahead, now, schedule)

    fee = get_consultation_fee(db)
    if branch is not None:
        branch_fee = branch.consultation_price if is_consultation else branch.consultation_fee
        if branch_fee is not None:
            fee = branch_fee

    return create_booking_with_queue_number(
        db,
        estimate_fn,
        full_name=data.full_name,
        phone=data.phone,
        email=data.email,
        treatment=treatment_value,
        service_type=service_type,
        date=data.date,
        time=None,
        message=data.message,
        consultation_fee=fee,
        branch_id=data.branch_id,
        payment_method=PaymentMethod(data.payment_method.value),
        payment_status=PaymentStatus.PENDING,
    )


def booking_to_public_response(db: Session, booking: Booking) -> dict:
    patients_ahead = count_patients_ahead(db, booking.date, booking.queue_number, booking.branch_id)
    return {
        "id": booking.id,
        "full_name": booking.full_name,
        "treatment": booking.treatment,
        "service_type": booking.service_type,
        "date": booking.date,
        "status": booking.status,
        "queue_number": booking.queue_number,
        "patients_ahead": patients_ahead,
        "estimated_arrival_start": booking.estimated_arrival_start,
        "estimated_arrival_end": booking.estimated_arrival_end,
        "consultation_fee": booking.consultation_fee,
        "branch_id": booking.branch_id,
        "branch_name": booking.branch_name,
        "payment_method": booking.payment_method,
        "payment_status": booking.payment_status,
    }


def get_active_booking_for_phone(db: Session, phone: str) -> dict:
    """Public: the patient's current active (pending/confirmed) booking, if any,
    in the same safe, patient-facing shape as a booking confirmation. This turns
    the one-active-per-phone rule from an error into something the patient can
    see and manage before booking again."""
    existing = find_active_booking_for_phone(db, phone)
    if existing is None:
        return {"has_active_booking": False, "booking": None}
    return {"has_active_booking": True, "booking": booking_to_public_response(db, existing)}


def _owned_active_booking(db: Session, booking_id: int, phone: str) -> Booking:
    """Fetch a booking for a public self-service action, checking the phone owns
    it — reusing the existing tolerant phone matching (no second matching
    system), the same ownership posture as confirm_online_payment."""
    booking = crud_get(db, booking_id)
    if booking is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found")
    if not _phones_match(booking.phone, phone):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Phone number does not match this booking.",
        )
    return booking


def reschedule_booking(db: Session, booking_id: int, new_date: str, phone: str) -> Booking:
    """Public: move the patient's existing active booking to a new date instead
    of creating a duplicate. Validates the new date against the booking's own
    branch schedule / window / capacity and assigns a fresh queue number +
    estimate for it — never a second active booking."""
    booking = _owned_active_booking(db, booking_id, phone)
    if booking.status not in STILL_WAITING_STATUSES:
        # Cancelled/completed between the patient's lookup and this call.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This booking can no longer be changed.",
        )
    if new_date == booking.date:
        return booking  # no change requested — keep the existing number/estimate

    schedule = branch_working_hours(booking.branch)
    booking_date = _validate_booking_date(db, new_date, booking.branch_id, schedule)
    now = datetime.now()

    def estimate_fn(patients_ahead: int):
        return _estimate_window(booking_date, patients_ahead, now, schedule)

    return reschedule_booking_with_queue_number(db, booking, estimate_fn, new_date)


def cancel_booking_public(db: Session, booking_id: int, phone: str) -> Booking:
    """Public: cancel the patient's own booking through the existing status
    mechanism (never a hard delete). A cancelled booking no longer counts as
    active, so the patient can immediately book again."""
    booking = _owned_active_booking(db, booking_id, phone)
    if booking.status == BookingStatus.CANCELLED:
        return booking  # idempotent — already cancelled
    if booking.status == BookingStatus.COMPLETED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A completed booking cannot be cancelled.",
        )
    return crud_update_status(db, booking_id, BookingStatus.CANCELLED)


def get_queue_status(db: Session, booking_id: int) -> dict:
    booking = crud_get(db, booking_id)
    if booking is None or booking.queue_number is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found")

    patients_ahead = count_patients_ahead(db, booking.date, booking.queue_number, booking.branch_id)
    serving = get_currently_serving(db, booking.date, booking.branch_id)

    return {
        "id": booking.id,
        "date": booking.date,
        "queue_number": booking.queue_number,
        "status": booking.status,
        "patient_arrived": booking.patient_arrived,
        "patients_ahead": patients_ahead,
        "currently_serving": serving.queue_number if serving else None,
        "estimated_arrival_start": booking.estimated_arrival_start,
        "estimated_arrival_end": booking.estimated_arrival_end,
        "payment_method": booking.payment_method,
        "payment_status": booking.payment_status,
    }


def confirm_online_payment(db: Session, booking_id: int, phone: str) -> Booking:
    booking = crud_get(db, booking_id)
    if booking is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found")
    if booking.payment_method != PaymentMethod.ONLINE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This booking was not set up for online payment.",
        )
    if booking.phone != phone:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Phone number does not match this booking.")
    if booking.payment_status == PaymentStatus.PAID:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Payment has already been confirmed for this booking.")

    # ── Simulated payment gateway ────────────────────────────────────────
    # No real payment provider is configured for this project. In
    # production this branch would be replaced by verifying a signed
    # webhook/callback from the actual gateway (Stripe, Paymob, etc.)
    # instead of trusting the client's request directly.
    updated = crud_set_payment_paid(db, booking_id)
    return updated


def _stamp_audit(db: Session, booking: Booking, current_user: User) -> Booking:
    """Record who last touched this booking and, if no branch has claimed it
    yet, which branch handled the patient (see core/database.py Booking)."""
    booking.updated_by = current_user.username
    if booking.branch_id is None and current_user.branch_id is not None:
        booking.branch_id = current_user.branch_id
    db.commit()
    db.refresh(booking)
    return booking


def record_payment(db: Session, booking_id: int, current_user: User) -> Booking:
    """Staff confirms the visit's fee was paid (in person at the clinic, or
    an online booking staff is settling manually — payment_method is not
    restricted here, unlike confirm_online_payment above).

    Enforces the workflow rule: a booking must already be confirmed before
    payment can be recorded, and the same visit can never be paid twice.
    """
    booking = crud_get(db, booking_id)
    if booking is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found")
    if booking.status != BookingStatus.CONFIRMED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The appointment must be confirmed before payment can be recorded.",
        )
    if booking.payment_status == PaymentStatus.PAID:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Payment has already been recorded for this visit.",
        )
    # A visit is paid at the clinic, so it can't be settled before its day has
    # come — block recording payment on a still-upcoming (future-dated) booking.
    try:
        booking_date = date.fromisoformat(booking.date) if booking.date else None
    except ValueError:
        booking_date = None
    if booking_date and booking_date > date.today():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Payment can only be recorded once the booking day has arrived.",
        )
    booking = crud_set_payment_paid(db, booking_id)
    return _stamp_audit(db, booking, current_user)


def register_consultation(db: Session, booking_id: int, current_user: User) -> Booking:
    """Staff registers a follow-up consultation for this visit. Creates a
    real service_type=CONSULTATION Booking for the same patient — through
    the same queue-assignment path a patient's own booking would use — and
    links it back onto this visit so it can't be registered twice.

    Enforces the workflow rule: payment must be recorded and the patient
    must be checked in before a consultation can be registered.
    """
    booking = crud_get(db, booking_id)
    if booking is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found")
    if booking.service_type == ServiceType.CONSULTATION:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This booking is already a consultation.",
        )
    if booking.payment_status != PaymentStatus.PAID:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Payment must be recorded before a consultation can be registered.",
        )
    if not booking.patient_arrived:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The patient must be checked in before a consultation can be registered.",
        )
    if booking.consultation_registered:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A consultation has already been registered for this visit.",
        )

    branch = booking.branch

    fee = get_consultation_fee(db)
    if branch is not None and branch.consultation_price is not None:
        fee = branch.consultation_price

    # A registered consultation goes straight to the Consultations list — it is
    # NOT placed in any day's queue. It gets no date and no queue number until
    # staff optionally assign a date from that list (see set_consultation_date).
    consultation_booking = create_list_only_consultation(
        db,
        full_name=booking.full_name,
        phone=booking.phone,
        email=booking.email,
        treatment=CONSULTATION_LABEL,
        service_type=ServiceType.CONSULTATION,
        time=None,
        message=None,
        consultation_fee=fee,
        branch_id=booking.branch_id,
        payment_method=PaymentMethod.CLINIC,
        payment_status=PaymentStatus.PENDING,
    )

    booking.consultation_registered = True
    booking.consultation_booking_id = consultation_booking.id
    return _stamp_audit(db, booking, current_user)


def set_consultation_date(db: Session, booking_id: int, new_date: str, current_user: User) -> Booking:
    """Assign (or clear) the date on a list-only consultation from the
    Consultations list. It's just a scheduling note — the consultation stays in
    that list and never enters a day's queue, so no queue number is assigned.
    Empty string clears the date back to 'unscheduled'."""
    booking = crud_get(db, booking_id)
    if booking is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found")
    # Only list-only consultations (no queue number) can be dated this way — a
    # patient-booked, queued consultation is scheduled through the normal flow.
    if booking.service_type != ServiceType.CONSULTATION or booking.queue_number is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A date can only be set on a list-only consultation.",
        )
    new_date = (new_date or "").strip()
    if new_date and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", new_date):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Date must be in YYYY-MM-DD format.",
        )
    booking.date = new_date
    return _stamp_audit(db, booking, current_user)


def mark_arrival(db: Session, booking_id: int, arrived: bool, current_user: User) -> Booking:
    booking = crud_get(db, booking_id)
    if booking is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found")

    if arrived:
        # A list-only consultation isn't tied to a scheduled day, so it can be
        # marked as attended whenever the patient actually comes. A regular
        # appointment can still only be checked in on its own booking day.
        # (No working-hours gate either way — staff check patients in whenever
        # they walk in, early, late, or after the posted closing time.)
        if booking.service_type != ServiceType.CONSULTATION:
            booking_date = _parse_date(booking.date)
            today = date.today()
            if booking_date != today:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="A patient can only be marked as entered on the day of their booking.",
                )
        if booking.status == BookingStatus.CANCELLED:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This booking was cancelled and cannot be marked as entered.",
            )

    booking = crud_set_arrival(db, booking_id, arrived)
    return _stamp_audit(db, booking, current_user)


def set_consultation_hint(db: Session, booking_id: int, dismissed: bool, current_user: User) -> Booking:
    booking = crud_set_hint(db, booking_id, dismissed)
    if booking is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found")
    return _stamp_audit(db, booking, current_user)


def change_booking_status(db: Session, booking_id: int, update: BookingStatusUpdate, current_user: User):
    # "completed" was a manual staff action (the old "Complete" button); it's
    # been fully retired in favor of the payment + consultation-registration
    # workflow (see record_payment/register_consultation above), so no new
    # transition to it is accepted here — checked server-side so it can't be
    # reached by calling this endpoint directly, even though the frontend no
    # longer offers a way to select it either. Bookings that already carry
    # this status from before are untouched and keep displaying correctly.
    if update.status == BookingStatusEnum.COMPLETED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The 'completed' status can no longer be set directly.",
        )
    booking = crud_update_status(db, booking_id, BookingStatus(update.status.value))
    if booking is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found")
    return _stamp_audit(db, booking, current_user)


def set_extra_charge(db: Session, booking_id: int, update: ExtraChargeUpdate, current_user: User) -> Booking:
    booking = crud_set_extra_charge(db, booking_id, update.amount, update.description, update.paid)
    if booking is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found")
    return _stamp_audit(db, booking, current_user)


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


def set_medical_record(db: Session, booking_id: int, update: MedicalRecordUpdate, current_user: User) -> Booking:
    booking = crud_set_medical_record(
        db,
        booking_id,
        diagnosis=_clean(update.diagnosis),
        prescription=_clean(update.prescription),
        follow_up_needed=update.follow_up_needed,
        follow_up_notes=_clean(update.follow_up_notes),
        chronic_conditions=_clean(update.chronic_conditions),
        current_medications=_clean(update.current_medications),
    )
    if booking is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found")
    return _stamp_audit(db, booking, current_user)


def remove_booking(db: Session, booking_id: int):
    if not crud_delete(db, booking_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found")
    return True


def list_bookings(
    db: Session,
    skip: int = 0,
    limit: int = 50,
    status_filter: str | None = None,
    date: str | None = None,
    branch_id: int | None = None,
):
    bs = BookingStatus(status_filter) if status_filter else None
    return crud_all(db, skip=skip, limit=limit, status=bs, date=date, branch_id=branch_id)


def get_single_booking(db: Session, booking_id: int):
    booking = crud_get(db, booking_id)
    if booking is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found")
    return booking


def get_patient_bookings(db: Session, phone: str) -> list[Booking]:
    """A patient's full record, pulled by phone — the identity key, since
    patients have no account. Not paginated: unlike the staff list endpoint,
    this must never silently drop a patient's older visits."""
    return crud_get_by_phone(db, phone)
