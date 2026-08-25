"""
Booking endpoints.

Public:
  POST   /bookings/                    – Submit a queue-based booking request (no auth needed)
  GET    /bookings/{id}/queue-status   – Live queue position for one booking
  POST   /bookings/{id}/pay            – Confirm simulated online payment

Staff / Admin (JWT required):
  GET    /bookings/                    – List all bookings (optional ?status=, ?date=)
  GET    /bookings/{id}                – Get a single booking
  PATCH  /bookings/{id}/status         – Update a booking's status
  PATCH  /bookings/{id}/arrival        – Mark a patient as entered / not entered
  DELETE /bookings/{id}                – Remove a booking
  POST   /bookings/reminders/dispatch  – Send due WhatsApp reminders
"""

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from core.dependencies import get_db, require_staff, require_admin
from core.database import User
from schemas.booking import (
    BookingCreate,
    BookingStatusUpdate,
    BookingResponse,
    BookingPublicResponse,
    ActiveBookingResponse,
    BookingRescheduleRequest,
    BookingCancelRequest,
    QueueStatusResponse,
    ArrivalUpdate,
    ConsultationHintUpdate,
    ConsultationDateUpdate,
    ExtraChargeUpdate,
    MedicalRecordUpdate,
    PaymentConfirmRequest,
)
from services.booking_service import (
    validate_and_create_booking,
    booking_to_public_response,
    get_active_booking_for_phone,
    reschedule_booking,
    cancel_booking_public,
    get_queue_status,
    confirm_online_payment,
    record_payment,
    register_consultation,
    set_consultation_date,
    mark_arrival,
    set_consultation_hint,
    set_extra_charge,
    set_medical_record,
    list_bookings,
    get_single_booking,
    get_patient_bookings,
    change_booking_status,
    remove_booking,
)
from services.reminder_service import dispatch_due_reminders

router = APIRouter(prefix="/bookings", tags=["Bookings"])


# ── Public ────────────────────────────────────────────────────────────────────
@router.post(
    "/",
    response_model=BookingPublicResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Submit a booking request (public)",
)
def create_booking(data: BookingCreate, db: Session = Depends(get_db)):
    booking = validate_and_create_booking(db, data)
    return booking_to_public_response(db, booking)


# NOTE: registered before "/{booking_id}" so "active" isn't parsed as an id.
@router.get(
    "/active",
    response_model=ActiveBookingResponse,
    summary="The active booking for a phone number, if any (public)",
)
def active_booking(phone: str = Query(..., min_length=6, max_length=30), db: Session = Depends(get_db)):
    return get_active_booking_for_phone(db, phone)


@router.patch(
    "/{booking_id}/reschedule",
    response_model=BookingPublicResponse,
    summary="Change the date of your existing booking (public)",
)
def reschedule_my_booking(booking_id: int, body: BookingRescheduleRequest, db: Session = Depends(get_db)):
    booking = reschedule_booking(db, booking_id, body.date, body.phone)
    return booking_to_public_response(db, booking)


@router.patch(
    "/{booking_id}/cancel",
    response_model=BookingPublicResponse,
    summary="Cancel your existing booking (public)",
)
def cancel_my_booking(booking_id: int, body: BookingCancelRequest, db: Session = Depends(get_db)):
    booking = cancel_booking_public(db, booking_id, body.phone)
    return booking_to_public_response(db, booking)


@router.get(
    "/{booking_id}/queue-status",
    response_model=QueueStatusResponse,
    summary="Live queue position for a booking (public)",
)
def queue_status(booking_id: int, db: Session = Depends(get_db)):
    return get_queue_status(db, booking_id)


@router.post(
    "/{booking_id}/pay",
    response_model=BookingResponse,
    summary="Confirm simulated online payment (public)",
)
def pay_booking(booking_id: int, body: PaymentConfirmRequest, db: Session = Depends(get_db)):
    return confirm_online_payment(db, booking_id, body.phone)


# ── Staff / Admin ─────────────────────────────────────────────────────────────
@router.get(
    "/",
    response_model=list[BookingResponse],
    summary="List bookings (staff)",
)
def list_all_bookings(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    status_filter: str | None = Query(None, alias="status"),
    date: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    branch_id: int | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff),
):
    # Staff tied to a branch only ever see that branch's bookings — any
    # branch_id they pass is ignored in favor of their own. Staff with no
    # branch assigned (e.g. the seeded default account) and admins keep
    # seeing everything unless a branch_id is explicitly requested.
    effective_branch_id = current_user.branch_id if current_user.branch_id is not None else branch_id
    return list_bookings(db, skip=skip, limit=limit, status_filter=status_filter, date=date, branch_id=effective_branch_id)


@router.get(
    "/patient/{phone}",
    response_model=list[BookingResponse],
    summary="Full booking history for a patient, pulled by phone number (staff)",
)
def get_patient_bookings_endpoint(
    phone: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_staff),
):
    return get_patient_bookings(db, phone)


@router.get(
    "/{booking_id}",
    response_model=BookingResponse,
    summary="Get a single booking (staff)",
)
def get_booking(
    booking_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_staff),
):
    return get_single_booking(db, booking_id)


@router.patch(
    "/{booking_id}/status",
    response_model=BookingResponse,
    summary="Update booking status (staff)",
)
def update_status(
    booking_id: int,
    body: BookingStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff),
):
    return change_booking_status(db, booking_id, body, current_user)


@router.patch(
    "/{booking_id}/arrival",
    response_model=BookingResponse,
    summary="Mark a patient as entered / not entered (staff)",
)
def update_arrival(
    booking_id: int,
    body: ArrivalUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff),
):
    return mark_arrival(db, booking_id, body.arrived, current_user)


@router.patch(
    "/{booking_id}/payment",
    response_model=BookingResponse,
    summary="Record the visit's fee as paid (staff)",
)
def mark_payment_done(
    booking_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff),
):
    return record_payment(db, booking_id, current_user)


@router.post(
    "/{booking_id}/register-consultation",
    response_model=BookingResponse,
    summary="Register a follow-up consultation for this visit (staff)",
)
def create_consultation_from_booking(
    booking_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff),
):
    return register_consultation(db, booking_id, current_user)


@router.patch(
    "/{booking_id}/consultation-date",
    response_model=BookingResponse,
    summary="Set/clear the date on a list-only consultation (staff)",
)
def update_consultation_date(
    booking_id: int,
    body: ConsultationDateUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff),
):
    return set_consultation_date(db, booking_id, body.date, current_user)


@router.patch(
    "/{booking_id}/consultation-hint",
    response_model=BookingResponse,
    summary="Show/hide the 'has consultation' reminder on a completed exam (staff)",
)
def update_consultation_hint(
    booking_id: int,
    body: ConsultationHintUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff),
):
    return set_consultation_hint(db, booking_id, body.dismissed, current_user)


@router.patch(
    "/{booking_id}/extra-charge",
    response_model=BookingResponse,
    summary="Set/update an extra charge on top of the base appointment (staff)",
)
def update_extra_charge(
    booking_id: int,
    body: ExtraChargeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_staff),
):
    return set_extra_charge(db, booking_id, body, current_user)


@router.patch(
    "/{booking_id}/medical-record",
    response_model=BookingResponse,
    summary="Save the clinical record (diagnosis, prescription, …) for a visit (admin)",
)
def update_medical_record(
    booking_id: int,
    body: MedicalRecordUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    return set_medical_record(db, booking_id, body, current_user)


@router.post(
    "/reminders/dispatch",
    summary="Send WhatsApp reminders to patients whose turn is approaching (staff)",
)
def dispatch_reminders(
    db: Session = Depends(get_db),
    _: User = Depends(require_staff),
):
    return dispatch_due_reminders(db)


@router.delete(
    "/{booking_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a booking (staff)",
)
def delete_booking_endpoint(
    booking_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_staff),
):
    remove_booking(db, booking_id)
