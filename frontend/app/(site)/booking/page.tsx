"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ArrowLeft,
  Check,
  Calendar as CalendarIcon,
  Clock,
  Users,
  Info,
  ShieldCheck,
  Building2,
  Loader2,
  TriangleAlert,
} from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { SERVICE_OPTIONS, CONSULTATION_SERVICE } from "@/lib/constants";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import {
  ApiError,
  Availability,
  BookingConfirmation,
  ClinicSchedule,
  DayHours,
  PaymentMethod,
  PublicBranch,
  QueueStatus,
  WorkingHours,
  confirmOnlinePayment,
  getAvailability,
  getActiveBooking,
  rescheduleBooking,
  cancelBooking,
  getClinicSchedule,
  getQueueStatus,
  listPublicBranches,
  submitBooking,
} from "@/lib/api";

type Step = "branch" | "date" | "details" | "existing" | "payment" | "online" | "confirmed";

type Fields = {
  fullName: string;
  phone: string;
  email: string;
  treatment: string;
  branchId: string;
  message: string;
};

const EMPTY_FIELDS: Fields = {
  fullName: "",
  phone: "",
  email: "",
  treatment: "",
  branchId: "",
  message: "",
};

// Booking values must stay the exact English strings the backend validates
// against (VALID_TREATMENTS) and that already-stored bookings use — only the
// label shown to the patient gets translated.
const TREATMENT_LABEL_KEYS: Record<string, string> = {
  [CONSULTATION_SERVICE]: "treatmentConsultation",
  "Cosmetic Dentistry": "treatmentCosmetic",
  "Dental Implants": "treatmentImplants",
  "Teeth Whitening": "treatmentWhitening",
  "Orthodontics": "treatmentOrthodontics",
  "General Dentistry": "treatmentGeneral",
  "Pediatric Dentistry": "treatmentPediatric",
};

const inputBase =
  "w-full rounded-xl border bg-white/60 px-4 py-3 text-ink outline-none transition-colors duration-200 placeholder:text-ink/35 focus:border-gold focus:ring-2 focus:ring-gold/25";
const labelBase = "mb-2 block text-xs font-medium uppercase tracking-[0.15em] text-ink/60";

// Saturday-first — matches how the clinic's own week reads (open Sat–Thu).
const DAY_ORDER: (keyof WorkingHours)[] = ["saturday", "sunday", "monday", "tuesday", "wednesday", "thursday", "friday"];

function sameHours(a: DayHours | null, b: DayHours | null) {
  if (a === null && b === null) return true;
  if (!a || !b) return false;
  return a.opens === b.opens && a.closes === b.closes;
}

/** "14:30" -> "2:30 PM" / "2:30 م" — so hours read clearly as morning or
 * evening instead of an easy-to-misread 24-hour value. */
function formatHourMinute(hhmm: string, locale: "en" | "ar") {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const d = new Date(2000, 0, 1, h, m);
  return d.toLocaleTimeString(locale === "ar" ? "ar-EG-u-nu-latn" : "en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Groups consecutive days sharing identical hours into one line each, e.g.
 * ["Sat–Thu: 10:00 AM–9:00 PM", "Fri: Closed"] instead of one line per day. */
function formatBranchHours(
  wh: WorkingHours,
  t: (key: string, vars?: Record<string, string | number>) => string,
  locale: "en" | "ar"
): string[] {
  const groups: { days: (keyof WorkingHours)[]; hours: DayHours | null }[] = [];
  for (const day of DAY_ORDER) {
    const hours = wh[day] ?? null;
    const last = groups[groups.length - 1];
    if (last && sameHours(last.hours, hours)) {
      last.days.push(day);
    } else {
      groups.push({ days: [day], hours });
    }
  }
  return groups.map((g) => {
    const first = t(`site.booking.days.${g.days[0]}`);
    const last = t(`site.booking.days.${g.days[g.days.length - 1]}`);
    const dayLabel = g.days.length === 1 ? first : `${first}–${last}`;
    const hoursLabel = g.hours
      ? `${formatHourMinute(g.hours.opens, locale)}–${formatHourMinute(g.hours.closes, locale)}`
      : t("site.booking.closedDay");
    return `${dayLabel}: ${hoursLabel}`;
  });
}

function todayIso() {
  return new Date().toISOString().split("T")[0];
}

function formatDateLong(dateStr: string, locale: "en" | "ar") {
  try {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dateLocale = locale === "ar" ? "ar-EG-u-nu-latn" : "en-US";
    return new Date(y, m - 1, d).toLocaleDateString(dateLocale, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function formatTime(iso?: string | null) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  } catch {
    return null;
  }
}

function formatTimeRange(start: string | null | undefined, end: string | null | undefined, fallback: string) {
  const a = formatTime(start);
  const b = formatTime(end);
  if (!a || !b) return fallback;
  return a === b ? a : `${a} – ${b}`;
}

export default function BookingPage() {
  const { t, locale } = useLanguage();
  const treatmentLabel = (opt: string) => {
    const key = TREATMENT_LABEL_KEYS[opt];
    return key ? t(`site.booking.${key}`) : opt;
  };
  const STEPS: { id: Step; label: string }[] = [
    { id: "branch", label: t("site.booking.stepBranch") },
    { id: "date", label: t("site.booking.stepDate") },
    { id: "details", label: t("site.booking.stepDetails") },
    { id: "payment", label: t("site.booking.stepPayment") },
    { id: "confirmed", label: t("site.booking.stepConfirmed") },
  ];
  const [step, setStep] = useState<Step>("branch");

  const [schedule, setSchedule] = useState<ClinicSchedule | null>(null);
  const [branches, setBranches] = useState<PublicBranch[]>([]);
  const [date, setDate] = useState("");
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [dateError, setDateError] = useState("");
  const dateCheckId = useRef(0);

  const [fields, setFields] = useState<Fields>(EMPTY_FIELDS);
  const [errors, setErrors] = useState<Partial<Record<keyof Fields, string>>>({});

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const [confirmation, setConfirmation] = useState<BookingConfirmation | null>(null);
  const [liveQueue, setLiveQueue] = useState<QueueStatus | null>(null);

  const [payingOnline, setPayingOnline] = useState(false);
  const [payError, setPayError] = useState("");

  // ── Existing active booking management ──────────────────────────────────
  // When the entered phone already has an active booking, we surface it (via
  // the "existing" step) so the patient can keep / reschedule / cancel it,
  // instead of the one-active-per-phone rule showing up as a red error.
  const [activeBooking, setActiveBooking] = useState<BookingConfirmation | null>(null);
  const activeCheckId = useRef(0);
  const [existingMode, setExistingMode] = useState<"actions" | "changeDate" | "confirmCancel">("actions");
  const [existingBusy, setExistingBusy] = useState(false);
  const [existingError, setExistingError] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newDateAvail, setNewDateAvail] = useState<Availability | null>(null);
  const [checkingNewDate, setCheckingNewDate] = useState(false);
  const [newDateError, setNewDateError] = useState("");
  const newDateCheckId = useRef(0);

  const successRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listPublicBranches()
      .then((list) => {
        setBranches(list);
        // No branches configured yet — skip the branch step entirely.
        if (list.length === 0) setStep((s) => (s === "branch" ? "date" : s));
      })
      .catch(() => {
        /* booking still works without a branch */
      });
  }, []);

  // Refetch whenever the selected branch changes so working days/hours (and
  // the min/max bounds below) reflect that branch — schedule is a
  // nice-to-have for min/max bounds either way; availability still
  // validates server-side.
  useEffect(() => {
    getClinicSchedule(fields.branchId ? Number(fields.branchId) : undefined)
      .then(setSchedule)
      .catch(() => {});
  }, [fields.branchId]);

  // A date picked for one branch isn't necessarily valid for another (they
  // can have different working days/hours) — clear it whenever the branch
  // changes (e.g. the patient goes back and switches branches) so a stale
  // "available" date from the previous branch can't slip through.
  const isFirstBranchRender = useRef(true);
  useEffect(() => {
    if (isFirstBranchRender.current) {
      isFirstBranchRender.current = false;
      return;
    }
    setDate("");
    setAvailability(null);
    setDateError("");
  }, [fields.branchId]);

  useEffect(() => {
    if (step === "confirmed" && successRef.current) successRef.current.focus();
  }, [step]);

  // Poll live queue position on the confirmation screen so patients see the
  // queue move as other patients are served (point 13 — dynamic updates).
  useEffect(() => {
    if (step !== "confirmed" || !confirmation) return;
    let cancelled = false;

    const poll = () => {
      getQueueStatus(confirmation.id)
        .then((q) => {
          if (!cancelled) setLiveQueue(q);
        })
        .catch(() => {
          /* keep showing the last known state on a transient failure */
        });
    };

    poll();
    const interval = setInterval(poll, 20000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [step, confirmation]);

  // As soon as the patient has typed a plausible phone in the details step,
  // check (debounced) whether it already has an active booking — if so, show
  // the existing booking instead of letting them create a duplicate. A failed
  // lookup is intentionally silent: the backend re-checks on submit, so we
  // never wrongly assume "no booking" on a transient error.
  useEffect(() => {
    if (step !== "details") return;
    const digits = fields.phone.replace(/\D/g, "");
    if (digits.length < 7) return;
    const handle = setTimeout(async () => {
      const requestId = ++activeCheckId.current;
      try {
        const res = await getActiveBooking(fields.phone);
        if (requestId !== activeCheckId.current) return;
        if (res.has_active_booking && res.booking) showExistingBooking(res.booking);
      } catch {
        /* silent — authoritative check happens again on submit */
      }
    }, 600);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields.phone, step]);

  const selectedBranch = useMemo(
    () => branches.find((b) => String(b.id) === fields.branchId) ?? null,
    [branches, fields.branchId],
  );

  // The branch's own fee (exam or, for a consultation, its consultation
  // price) takes over from the clinic-wide default once one is selected.
  const amountToPay = useMemo(() => {
    if (selectedBranch) {
      const branchFee =
        fields.treatment === CONSULTATION_SERVICE ? selectedBranch.consultation_price : selectedBranch.consultation_fee;
      if (branchFee != null) return branchFee;
    }
    return schedule?.consultation_fee ?? 0;
  }, [selectedBranch, fields.treatment, schedule]);

  const maxDate = useMemo(() => {
    if (!schedule) return undefined;
    const d = new Date();
    d.setDate(d.getDate() + schedule.booking_window_days);
    return d.toISOString().split("T")[0];
  }, [schedule]);

  const handleDateChange = async (value: string) => {
    setDate(value);
    setDateError("");
    setAvailability(null);
    if (!value) return;
    // If the patient changes the date again (or goes back and forth) before
    // this check comes back, an older, slower response landing after a newer
    // one would otherwise overwrite it with stale availability for a date
    // that's no longer selected — guard against that here.
    const requestId = ++dateCheckId.current;
    setCheckingAvailability(true);
    try {
      const av = await getAvailability(value, fields.branchId ? Number(fields.branchId) : undefined);
      if (requestId !== dateCheckId.current) return;
      setAvailability(av);
      if (!av.is_working_day || av.reason) {
        setDateError(av.reason || t("site.booking.dateNotAvailable"));
      }
    } catch (err) {
      if (requestId !== dateCheckId.current) return;
      setDateError(err instanceof ApiError ? err.message : t("site.booking.availabilityCheckError"));
    } finally {
      if (requestId === dateCheckId.current) setCheckingAvailability(false);
    }
  };

  const goToDetails = () => {
    if (!date || !availability || dateError || availability.date !== date || availability.next_queue_number === null) return;
    setStep("details");
  };

  const goToDate = () => {
    if (branches.length > 0 && !fields.branchId) {
      setErrors((e) => ({ ...e, branchId: t("site.booking.branchRequired") }));
      return;
    }
    setStep("date");
  };

  const set = (key: keyof Fields) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => {
    setFields((f) => ({ ...f, [key]: e.target.value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  const validateDetails = (f: Fields) => {
    const e: Partial<Record<keyof Fields, string>> = {};
    if (!f.fullName.trim()) e.fullName = t("site.booking.nameRequired");
    if (!f.phone.trim()) e.phone = t("site.booking.phoneRequired");
    else if (!/[0-9]{6,}/.test(f.phone.replace(/[^0-9]/g, "")))
      e.phone = t("site.booking.phoneInvalid");
    if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email))
      e.email = t("site.booking.emailInvalid");
    if (!f.treatment) e.treatment = t("site.booking.serviceRequired");
    return e;
  };

  const goToPayment = (e: React.FormEvent) => {
    e.preventDefault();
    const found = validateDetails(fields);
    setErrors(found);
    if (Object.keys(found).length === 0) setStep("payment");
  };

  const handleConfirmBooking = async () => {
    if (!paymentMethod) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const result = await submitBooking({
        full_name: fields.fullName,
        phone: fields.phone,
        email: fields.email || undefined,
        treatment: fields.treatment,
        service_type: fields.treatment === CONSULTATION_SERVICE ? "consultation" : "treatment",
        date,
        message: fields.message || undefined,
        payment_method: paymentMethod,
        branch_id: fields.branchId ? Number(fields.branchId) : undefined,
      });
      setConfirmation(result);
      setStep(paymentMethod === "online" ? "online" : "confirmed");
    } catch (err) {
      // A 409 at submit time is (almost always) a concurrent active booking for
      // this phone — fetch it and show the manage-booking UI instead of the raw
      // backend message. (If there's no active booking, it was another 409 such
      // as a full date, so we fall through to the generic error.)
      if (err instanceof ApiError && err.status === 409) {
        try {
          const res = await getActiveBooking(fields.phone);
          if (res.has_active_booking && res.booking) {
            showExistingBooking(res.booking);
            return;
          }
        } catch {
          /* fall through to the generic error below */
        }
      }
      setSubmitError(err instanceof ApiError ? err.message : t("site.booking.bookingError"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSimulatedPayment = async () => {
    if (!confirmation) return;
    setPayingOnline(true);
    setPayError("");
    try {
      await confirmOnlinePayment(confirmation.id, fields.phone);
      setConfirmation((c) => (c ? { ...c, payment_status: "paid" } : c));
      setStep("confirmed");
    } catch (err) {
      setPayError(err instanceof ApiError ? err.message : t("site.booking.paymentError"));
    } finally {
      setPayingOnline(false);
    }
  };

  const resetFlow = () => {
    setStep(branches.length > 0 ? "branch" : "date");
    setDate("");
    setAvailability(null);
    setFields(EMPTY_FIELDS);
    setErrors({});
    setPaymentMethod(null);
    setConfirmation(null);
    setLiveQueue(null);
    setSubmitError("");
    setPayError("");
  };

  // ── Existing-booking management handlers ────────────────────────────────
  function showExistingBooking(b: BookingConfirmation) {
    setActiveBooking(b);
    setExistingMode("actions");
    setExistingError("");
    setNewDate("");
    setNewDateAvail(null);
    setNewDateError("");
    setStep("existing");
  }

  const handleKeepBooking = () => {
    if (!activeBooking) return;
    setConfirmation(activeBooking);
    setStep("confirmed");
  };

  const handleNewDateChange = async (value: string) => {
    setNewDate(value);
    setNewDateError("");
    setNewDateAvail(null);
    if (!value) return;
    const requestId = ++newDateCheckId.current;
    setCheckingNewDate(true);
    try {
      const av = await getAvailability(value, activeBooking?.branch_id ?? undefined);
      if (requestId !== newDateCheckId.current) return;
      setNewDateAvail(av);
      if (!av.is_working_day || av.reason) setNewDateError(av.reason || t("site.booking.dateNotAvailable"));
    } catch (e) {
      if (requestId !== newDateCheckId.current) return;
      setNewDateError(e instanceof ApiError ? e.message : t("site.booking.availabilityCheckError"));
    } finally {
      if (requestId === newDateCheckId.current) setCheckingNewDate(false);
    }
  };

  const handleReschedule = async () => {
    if (
      !activeBooking ||
      !newDate ||
      !newDateAvail ||
      newDateError ||
      newDateAvail.date !== newDate ||
      newDateAvail.next_queue_number === null
    )
      return;
    setExistingBusy(true);
    setNewDateError("");
    try {
      const updated = await rescheduleBooking(activeBooking.id, newDate, fields.phone);
      setActiveBooking(null);
      setConfirmation(updated);
      setStep("confirmed");
    } catch (e) {
      // The booking may have been cancelled/completed since it was looked up —
      // refresh and route the patient appropriately instead of getting stuck.
      if (e instanceof ApiError && (e.status === 404 || e.status === 409)) {
        try {
          const res = await getActiveBooking(fields.phone);
          if (res.has_active_booking && res.booking) {
            showExistingBooking(res.booking);
            return;
          }
          setActiveBooking(null);
          setStep("details");
          return;
        } catch {
          /* fall through */
        }
      }
      setNewDateError(e instanceof ApiError ? e.message : t("site.booking.rescheduleError"));
    } finally {
      setExistingBusy(false);
    }
  };

  const handleCancelBooking = async () => {
    if (!activeBooking) return;
    setExistingBusy(true);
    setExistingError("");
    try {
      await cancelBooking(activeBooking.id, fields.phone);
      setActiveBooking(null);
      setExistingMode("actions");
      // Cancelled — no longer blocks the phone. Continue the normal flow with
      // the details already entered so the patient can book again immediately.
      setStep("details");
    } catch (e) {
      // Already cancelled/gone -> treat as success and continue.
      if (e instanceof ApiError && e.status === 404) {
        setActiveBooking(null);
        setStep("details");
        return;
      }
      setExistingError(e instanceof ApiError ? e.message : t("site.booking.cancelError"));
    } finally {
      setExistingBusy(false);
    }
  };

  const err = (key: keyof Fields) =>
    errors[key] ? (
      <p role="alert" className="mt-1.5 text-xs text-[#a83b2d]">
        {errors[key]}
      </p>
    ) : null;
  const border = (key: keyof Fields) => (errors[key] ? "border-[#a83b2d]/60" : "border-ink/15");

  const patientsAhead = liveQueue?.patients_ahead ?? confirmation?.patients_ahead ?? 0;
  const estimatedStart = liveQueue?.estimated_arrival_start ?? confirmation?.estimated_arrival_start;
  const estimatedEnd = liveQueue?.estimated_arrival_end ?? confirmation?.estimated_arrival_end;

  return (
    <>
      <Navbar minimal />
      <main className="min-h-screen w-full bg-cream px-6 pb-28 pt-32 md:px-10 md:pt-40 lg:px-14">
        <div className="mx-auto max-w-3xl">
          <p className="mb-6 flex items-center gap-3 text-[0.7rem] font-medium uppercase tracking-[0.32em] text-ink/50">
            <span className="h-px w-8 bg-gold" aria-hidden="true" />
            {t("site.booking.eyebrow")}
          </p>
          <h1 className="font-serif text-[2.25rem] font-medium leading-[1.05] tracking-[-0.02em] text-ink sm:text-5xl">
            {t("site.booking.headingPrefix")} <em className="italic text-ink/90">{t("site.booking.headingEmphasis")}</em>
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-ink/60">
            {t("site.booking.description")}
          </p>

          {/* Step indicator */}
          <ol className="mt-10 flex items-center gap-2 sm:gap-4">
            {STEPS.map((s, i) => {
              const indicatorStep = step === "online" ? "payment" : step === "existing" ? "details" : step;
              const currentIndex = STEPS.findIndex((x) => x.id === indicatorStep);
              const isActive = i === currentIndex;
              const isDone = i < currentIndex;
              return (
                <li key={s.id} className="flex items-center gap-2 sm:gap-4">
                  <span
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium transition-colors ${
                      isDone
                        ? "bg-ink text-cream"
                        : isActive
                        ? "bg-gold text-ink"
                        : "bg-ink/10 text-ink/40"
                    }`}
                  >
                    {isDone ? <Check className="h-4 w-4" /> : i + 1}
                  </span>
                  <span
                    className={`hidden text-xs font-medium uppercase tracking-[0.15em] sm:inline ${
                      isActive ? "text-ink" : "text-ink/40"
                    }`}
                  >
                    {s.label}
                  </span>
                  {i < STEPS.length - 1 && <span className="h-px w-6 bg-ink/15 sm:w-10" aria-hidden="true" />}
                </li>
              );
            })}
          </ol>

          <div className="mt-10 rounded-2xl border border-ink/10 bg-white/70 p-6 shadow-[0_20px_50px_-20px_rgba(16,24,32,0.15)] backdrop-blur-md sm:p-10">
            {/* ── STEP 0: BRANCH ───────────────────────────────────────────── */}
            {step === "branch" && (
              <div className="space-y-6">
                <div>
                  <p className={labelBase}>
                    {t("site.booking.branchLabel")} <span className="text-gold">*</span>
                  </p>
                  <div className="mt-2 grid gap-4 sm:grid-cols-2">
                    {branches.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => {
                          setFields((f) => ({ ...f, branchId: String(b.id) }));
                          setErrors((prev) => (prev.branchId ? { ...prev, branchId: undefined } : prev));
                        }}
                        className={`rounded-xl border p-5 text-left transition-all ${
                          fields.branchId === String(b.id)
                            ? "border-gold bg-gold/10 ring-2 ring-gold/25"
                            : "border-ink/15 bg-white/50 hover:border-ink/30"
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                              fields.branchId === String(b.id) ? "border-gold" : "border-ink/30"
                            }`}
                          >
                            {fields.branchId === String(b.id) && <span className="h-2 w-2 rounded-full bg-gold" />}
                          </span>
                          <span className="font-serif text-base font-medium text-ink">{b.name}</span>
                        </span>
                        {b.address && <span className="mt-2 block text-xs leading-relaxed text-ink/55">{b.address}</span>}
                        <span className="mt-3 flex flex-col gap-1 border-t border-ink/10 pt-3 text-[0.7rem] text-ink/55">
                          {formatBranchHours(b.working_hours, t, locale).map((line) => (
                            <span key={line} className="flex items-center gap-1.5">
                              <Clock className="h-3 w-3 shrink-0 text-gold" />
                              {line}
                            </span>
                          ))}
                        </span>
                      </button>
                    ))}
                  </div>
                  {err("branchId")}
                </div>

                <button
                  type="button"
                  onClick={goToDate}
                  disabled={!fields.branchId}
                  className="group inline-flex items-center justify-center gap-2 self-start rounded-full bg-ink px-8 py-4 text-xs font-medium uppercase tracking-[0.2em] text-cream transition-all duration-300 hover:bg-ink/85 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {t("site.booking.continue")}
                  <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
                </button>
              </div>
            )}

            {/* ── STEP 1: DATE ─────────────────────────────────────────────── */}
            {step === "date" && (
              <div className="space-y-6">
                <div>
                  <label htmlFor="booking-date" className={labelBase}>
                    {t("site.booking.selectDay")} <span className="text-gold">*</span>
                  </label>
                  <input
                    id="booking-date"
                    type="date"
                    min={todayIso()}
                    max={maxDate}
                    value={date}
                    onChange={(e) => handleDateChange(e.target.value)}
                    className={`${inputBase} border-ink/15 ${date ? "text-ink" : "text-ink/45"}`}
                  />
                  {dateError && (
                    <p role="alert" className="mt-2 text-xs text-[#a83b2d]">
                      {dateError}
                    </p>
                  )}
                </div>

                {checkingAvailability && (
                  <div className="flex items-center gap-2 text-sm text-ink/50">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("site.booking.checkingAvailability")}
                  </div>
                )}

                {availability && !dateError && (
                  <div className="rounded-xl border border-ink/10 bg-cream/60 p-5">
                    <p className="font-serif text-lg font-medium text-ink">{formatDateLong(date, locale)}</p>
                    <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="flex items-center gap-1.5 text-[0.65rem] uppercase tracking-wider text-ink/40">
                          <Users className="h-3.5 w-3.5" /> {t("site.booking.patientsBooked")}
                        </span>
                        <span className="mt-1 block font-serif text-2xl font-medium text-ink">
                          {availability.patients_booked}
                        </span>
                      </div>
                      <div>
                        <span className="flex items-center gap-1.5 text-[0.65rem] uppercase tracking-wider text-ink/40">
                          <ShieldCheck className="h-3.5 w-3.5" /> {t("site.booking.yourQueueWillBe")}
                        </span>
                        <span className="mt-1 block font-serif text-2xl font-medium text-gold">
                          #{availability.next_queue_number}
                        </span>
                      </div>
                    </div>
                    <p className="mt-4 flex items-start gap-1.5 text-xs text-ink/50">
                      <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {t("site.booking.openHours", {
                        opens: availability.opens ? formatHourMinute(availability.opens, locale) : "",
                        closes: availability.closes ? formatHourMinute(availability.closes, locale) : "",
                      })}
                    </p>
                  </div>
                )}

                <div className="flex items-center gap-3">
                  {branches.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setStep("branch")}
                      className="inline-flex items-center gap-2 rounded-full border border-ink/15 px-6 py-3.5 text-xs font-medium uppercase tracking-[0.2em] text-ink/70 transition-colors hover:text-ink"
                    >
                      <ArrowLeft className="h-4 w-4" /> {t("site.booking.back")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={goToDetails}
                    disabled={!availability || !!dateError || checkingAvailability || availability?.date !== date}
                    className="group inline-flex items-center justify-center gap-2 self-start rounded-full bg-ink px-8 py-4 text-xs font-medium uppercase tracking-[0.2em] text-cream transition-all duration-300 hover:bg-ink/85 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {t("site.booking.continue")}
                    <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
                  </button>
                </div>
              </div>
            )}

            {/* ── STEP 2: DETAILS ──────────────────────────────────────────── */}
            {step === "details" && (
              <form onSubmit={goToPayment} noValidate className="grid gap-6">
                <div className="grid gap-6 sm:grid-cols-2">
                  <div>
                    <label htmlFor="fullName" className={labelBase}>
                      {t("site.booking.fullName")} <span className="text-gold">*</span>
                    </label>
                    <input
                      id="fullName"
                      type="text"
                      autoComplete="name"
                      value={fields.fullName}
                      onChange={set("fullName")}
                      className={`${inputBase} ${border("fullName")}`}
                      placeholder={t("site.booking.fullNamePlaceholder")}
                    />
                    {err("fullName")}
                  </div>
                  <div>
                    <label htmlFor="phone" className={labelBase}>
                      {t("site.booking.phone")} <span className="text-gold">*</span>
                    </label>
                    <input
                      id="phone"
                      type="tel"
                      autoComplete="tel"
                      value={fields.phone}
                      onChange={set("phone")}
                      className={`${inputBase} ${border("phone")}`}
                      placeholder="+20 100 000 0000"
                    />
                    {err("phone")}
                  </div>
                </div>

                <div>
                  <label htmlFor="email" className={labelBase}>
                    {t("site.booking.email")}
                  </label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={fields.email}
                    onChange={set("email")}
                    className={`${inputBase} ${border("email")}`}
                    placeholder={t("site.booking.emailPlaceholder")}
                  />
                  {err("email")}
                </div>

                <div>
                  <label htmlFor="treatment" className={labelBase}>
                    {t("site.booking.service")} <span className="text-gold">*</span>
                  </label>
                  <select
                    id="treatment"
                    value={fields.treatment}
                    onChange={set("treatment")}
                    className={`${inputBase} ${border("treatment")} ${fields.treatment ? "text-ink" : "text-ink/35"}`}
                  >
                    <option value="" disabled>
                      {t("site.booking.selectService")}
                    </option>
                    {SERVICE_OPTIONS.map((opt) => (
                      <option key={opt} value={opt} className="text-ink">
                        {treatmentLabel(opt)}
                      </option>
                    ))}
                  </select>
                  {err("treatment")}
                  {fields.treatment === CONSULTATION_SERVICE && (
                    <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-gold/30 bg-gold/10 px-3 py-2 text-xs leading-relaxed text-ink/70">
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" />
                      <span>
                        {t("site.booking.consultationNotice", {
                          consultation: t("site.booking.consultationWord"),
                        }).split(t("site.booking.consultationWord")).map((part, i, arr) =>
                          i < arr.length - 1 ? (
                            <span key={i}>
                              {part}
                              <strong className="font-medium text-ink">{t("site.booking.consultationWord")}</strong>
                            </span>
                          ) : (
                            <span key={i}>{part}</span>
                          )
                        )}
                      </span>
                    </p>
                  )}
                </div>

                {selectedBranch && (
                  <div className="rounded-xl border border-gold/30 bg-gold/10 p-4 space-y-1.5">
                    {fields.treatment !== CONSULTATION_SERVICE && selectedBranch.consultation_fee != null && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-ink/60">{t("site.booking.consultationFeeLabel")}</span>
                        <span className="font-serif font-medium text-ink">
                          {selectedBranch.consultation_fee.toLocaleString("en-US")} {schedule?.currency ?? "EGP"}
                        </span>
                      </div>
                    )}
                    {fields.treatment === CONSULTATION_SERVICE && selectedBranch.consultation_price != null && (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-ink/60">{t("site.booking.consultationPriceLabel")}</span>
                        <span className="font-serif font-medium text-ink">
                          {selectedBranch.consultation_price.toLocaleString("en-US")} {schedule?.currency ?? "EGP"}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <label htmlFor="message" className={labelBase}>
                    {t("site.booking.message")} <span className="text-ink/35">{t("site.booking.optional")}</span>
                  </label>
                  <textarea
                    id="message"
                    rows={3}
                    value={fields.message}
                    onChange={set("message")}
                    className={`${inputBase} resize-none border-ink/15`}
                    placeholder={t("site.booking.messagePlaceholder")}
                  />
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setStep("date")}
                    className="inline-flex items-center gap-2 rounded-full border border-ink/15 px-6 py-3.5 text-xs font-medium uppercase tracking-[0.2em] text-ink/70 transition-colors hover:text-ink"
                  >
                    <ArrowLeft className="h-4 w-4" /> {t("site.booking.back")}
                  </button>
                  <button
                    type="submit"
                    className="group inline-flex items-center justify-center gap-2 rounded-full bg-ink px-8 py-4 text-xs font-medium uppercase tracking-[0.2em] text-cream transition-all duration-300 hover:bg-ink/85"
                  >
                    {t("site.booking.continue")}
                    <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
                  </button>
                </div>
              </form>
            )}

            {/* ── STEP 2b: EXISTING ACTIVE BOOKING (manage instead of error) ──── */}
            {step === "existing" && activeBooking && (
              <div className="space-y-6">
                <div className="flex items-start gap-3 rounded-xl border border-gold/40 bg-gold/10 p-4">
                  <Info className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
                  <div>
                    <h2 className="font-serif text-xl font-medium text-ink">{t("site.booking.existingTitle")}</h2>
                    <p className="mt-1 text-sm leading-relaxed text-ink/60">{t("site.booking.existingSubtitle")}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 rounded-xl border border-ink/10 bg-cream/60 p-5 sm:grid-cols-3">
                  <div>
                    <span className="block text-[0.62rem] uppercase tracking-wider text-ink/40">{t("site.booking.existingName")}</span>
                    <span className="font-serif text-base font-medium text-ink">{activeBooking.full_name}</span>
                  </div>
                  <div>
                    <span className="block text-[0.62rem] uppercase tracking-wider text-ink/40">{t("site.booking.service2")}</span>
                    <span className="font-serif text-base font-medium text-ink">{treatmentLabel(activeBooking.treatment)}</span>
                  </div>
                  {activeBooking.branch_name && (
                    <div>
                      <span className="block text-[0.62rem] uppercase tracking-wider text-ink/40">{t("site.booking.branchLabel")}</span>
                      <span className="font-serif text-base font-medium text-ink">{activeBooking.branch_name}</span>
                    </div>
                  )}
                  <div>
                    <span className="block text-[0.62rem] uppercase tracking-wider text-ink/40">{t("site.booking.date")}</span>
                    <span className="font-serif text-base font-medium text-ink">{formatDateLong(activeBooking.date, locale)}</span>
                  </div>
                  <div>
                    <span className="block text-[0.62rem] uppercase tracking-wider text-ink/40">{t("site.booking.queueNumber")}</span>
                    <span className="font-serif text-base font-medium text-gold">#{activeBooking.queue_number}</span>
                  </div>
                  <div>
                    <span className="block text-[0.62rem] uppercase tracking-wider text-ink/40">{t("site.booking.estimatedArrival")}</span>
                    <span className="font-serif text-base font-medium text-ink">
                      {formatTimeRange(activeBooking.estimated_arrival_start, activeBooking.estimated_arrival_end, t("site.booking.toBeConfirmed"))}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[0.62rem] uppercase tracking-wider text-ink/40">{t("site.booking.payment")}</span>
                    <span className="font-serif text-base font-medium text-ink">
                      {activeBooking.payment_method === "online" ? t("site.booking.paidOnline") : t("site.booking.payAtClinic")}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[0.62rem] uppercase tracking-wider text-ink/40">{t("site.booking.paymentStatus")}</span>
                    <span
                      className={`inline-block mt-0.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        activeBooking.payment_status === "paid" ? "bg-emerald-500/15 text-emerald-800" : "bg-amber-500/15 text-amber-800"
                      }`}
                    >
                      {activeBooking.payment_status === "paid" ? t("site.booking.paid") : t("site.booking.pending")}
                    </span>
                  </div>
                </div>

                {existingError && (
                  <div className="rounded-xl border border-[#a83b2d]/20 bg-[#a83b2d]/10 p-3.5 text-xs text-[#a83b2d]">{existingError}</div>
                )}

                {existingMode === "actions" && (
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <button
                      type="button"
                      onClick={handleKeepBooking}
                      className="group inline-flex items-center justify-center gap-2 rounded-full bg-ink px-8 py-4 text-xs font-medium uppercase tracking-[0.2em] text-cream transition-all duration-300 hover:bg-ink/85"
                    >
                      <Check className="h-4 w-4" /> {t("site.booking.keepBooking")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setExistingMode("changeDate")}
                      className="inline-flex items-center justify-center gap-2 rounded-full border border-ink/15 px-6 py-4 text-xs font-medium uppercase tracking-[0.2em] text-ink/70 transition-colors hover:border-ink/30 hover:text-ink"
                    >
                      <CalendarIcon className="h-4 w-4" /> {t("site.booking.changeDate")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setExistingMode("confirmCancel")}
                      className="inline-flex items-center justify-center gap-2 rounded-full border border-[#a83b2d]/30 px-6 py-4 text-xs font-medium uppercase tracking-[0.2em] text-[#a83b2d] transition-colors hover:bg-[#a83b2d]/10"
                    >
                      {t("site.booking.cancelBooking")}
                    </button>
                  </div>
                )}

                {existingMode === "changeDate" && (
                  <div className="space-y-4 rounded-xl border border-ink/10 bg-white/60 p-5">
                    <div>
                      <label htmlFor="reschedule-date" className={labelBase}>
                        {t("site.booking.pickNewDate")} <span className="text-gold">*</span>
                      </label>
                      <input
                        id="reschedule-date"
                        type="date"
                        min={todayIso()}
                        max={maxDate}
                        value={newDate}
                        onChange={(e) => handleNewDateChange(e.target.value)}
                        className={`${inputBase} border-ink/15 ${newDate ? "text-ink" : "text-ink/45"}`}
                      />
                      {newDateError && <p role="alert" className="mt-2 text-xs text-[#a83b2d]">{newDateError}</p>}
                    </div>
                    {checkingNewDate && (
                      <div className="flex items-center gap-2 text-sm text-ink/50">
                        <Loader2 className="h-4 w-4 animate-spin" /> {t("site.booking.checkingAvailability")}
                      </div>
                    )}
                    {newDateAvail && !newDateError && (
                      <div className="rounded-xl border border-ink/10 bg-cream/60 p-4">
                        <p className="font-serif text-base font-medium text-ink">{formatDateLong(newDate, locale)}</p>
                        <p className="mt-2 flex items-center gap-1.5 text-xs text-ink/60">
                          <Users className="h-3.5 w-3.5" /> {t("site.booking.yourQueueWillBe")}{" "}
                          <span className="font-medium text-gold">#{newDateAvail.next_queue_number}</span>
                        </p>
                      </div>
                    )}
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setExistingMode("actions");
                          setNewDate("");
                          setNewDateAvail(null);
                          setNewDateError("");
                        }}
                        className="inline-flex items-center gap-2 rounded-full border border-ink/15 px-6 py-3.5 text-xs font-medium uppercase tracking-[0.2em] text-ink/70 transition-colors hover:text-ink"
                      >
                        <ArrowLeft className="h-4 w-4" /> {t("site.booking.back")}
                      </button>
                      <button
                        type="button"
                        onClick={handleReschedule}
                        disabled={
                          !newDateAvail || !!newDateError || checkingNewDate || existingBusy || newDateAvail.next_queue_number === null
                        }
                        className="group inline-flex items-center justify-center gap-2 rounded-full bg-ink px-8 py-4 text-xs font-medium uppercase tracking-[0.2em] text-cream transition-all duration-300 hover:bg-ink/85 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {existingBusy ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" /> {t("site.booking.savingNewDate")}
                          </>
                        ) : (
                          <>
                            {t("site.booking.confirmNewDate")}
                            <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {existingMode === "confirmCancel" && (
                  <div className="space-y-4 rounded-xl border border-[#a83b2d]/30 bg-[#a83b2d]/10 p-5">
                    <p className="flex items-start gap-2 text-sm leading-relaxed text-[#a83b2d]">
                      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {t("site.booking.cancelConfirmText")}
                    </p>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setExistingMode("actions")}
                        className="inline-flex items-center gap-2 rounded-full border border-ink/15 px-6 py-3.5 text-xs font-medium uppercase tracking-[0.2em] text-ink/70 transition-colors hover:text-ink"
                      >
                        {t("site.booking.keepInstead")}
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelBooking}
                        disabled={existingBusy}
                        className="inline-flex items-center justify-center gap-2 rounded-full bg-[#a83b2d] px-8 py-4 text-xs font-medium uppercase tracking-[0.2em] text-white transition-all duration-300 hover:bg-[#a83b2d]/85 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {existingBusy ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" /> {t("site.booking.cancelling")}
                          </>
                        ) : (
                          t("site.booking.confirmCancel")
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── STEP 3: PAYMENT METHOD ──────────────────────────────────────── */}
            {step === "payment" && (
              <div className="space-y-6">
                {amountToPay > 0 && (
                  <div className="flex items-center justify-between gap-4 rounded-xl border border-gold/30 bg-gold/10 p-5">
                    <div>
                      <p className="text-[0.68rem] font-medium uppercase tracking-[0.2em] text-ink/50">
                        {t("site.booking.amountToPay")}
                      </p>
                      <p className="mt-1 font-serif text-3xl font-medium text-ink">
                        {amountToPay.toLocaleString("en-US")}{" "}
                        <span className="text-lg text-ink/60">{schedule?.currency ?? "EGP"}</span>
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-ink/5 px-3 py-1 text-[0.65rem] font-medium text-ink/60">
                      {fields.treatment === CONSULTATION_SERVICE
                        ? t("site.booking.consultationPriceLabel")
                        : t("site.booking.consultationFeeLabel")}
                    </span>
                  </div>
                )}

                <div>
                  <p className={labelBase}>{t("site.booking.howToPay")}</p>
                  <div className="mt-2 grid gap-4 sm:grid-cols-2">
                    {(
                      [
                        { id: "clinic" as const, title: t("site.booking.payAtClinicTitle"), desc: t("site.booking.payAtClinicDesc") },
                        { id: "online" as const, title: t("site.booking.payOnlineTitle"), desc: t("site.booking.payOnlineDesc") },
                      ]
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setPaymentMethod(opt.id)}
                        className={`rounded-xl border p-5 text-left transition-all ${
                          paymentMethod === opt.id
                            ? "border-gold bg-gold/10 ring-2 ring-gold/25"
                            : "border-ink/15 bg-white/50 hover:border-ink/30"
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                              paymentMethod === opt.id ? "border-gold" : "border-ink/30"
                            }`}
                          >
                            {paymentMethod === opt.id && <span className="h-2 w-2 rounded-full bg-gold" />}
                          </span>
                          <span className="font-serif text-base font-medium text-ink">{opt.title}</span>
                        </span>
                        <span className="mt-2 block text-xs leading-relaxed text-ink/55">{opt.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {submitError && (
                  <div className="rounded-xl border border-[#a83b2d]/20 bg-[#a83b2d]/10 p-3.5 text-xs text-[#a83b2d]">
                    {submitError}
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setStep("details")}
                    className="inline-flex items-center gap-2 rounded-full border border-ink/15 px-6 py-3.5 text-xs font-medium uppercase tracking-[0.2em] text-ink/70 transition-colors hover:text-ink"
                  >
                    <ArrowLeft className="h-4 w-4" /> {t("site.booking.back")}
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmBooking}
                    disabled={!paymentMethod || submitting}
                    className="group inline-flex items-center justify-center gap-2 rounded-full bg-ink px-8 py-4 text-xs font-medium uppercase tracking-[0.2em] text-cream transition-all duration-300 hover:bg-ink/85 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> {t("site.booking.bookingInProgress")}
                      </>
                    ) : (
                      <>
                        {paymentMethod === "online" ? t("site.booking.continueToPayment") : t("site.booking.confirmBooking")}
                        <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* ── STEP 3b: SIMULATED ONLINE PAYMENT ───────────────────────────── */}
            {step === "online" && confirmation && (
              <div className="space-y-6">
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-800">
                  <strong className="font-medium">{t("site.booking.demoGatewayTitle")}</strong>{" "}
                  {t("site.booking.demoGatewayBody")}
                </div>

                <div className="rounded-xl border border-ink/10 bg-cream/60 p-5">
                  <p className="text-[0.65rem] uppercase tracking-wider text-ink/40">{t("site.booking.amountDue")}</p>
                  <p className="font-serif text-3xl font-medium text-ink">
                    {confirmation.consultation_fee && confirmation.consultation_fee > 0
                      ? `${confirmation.consultation_fee.toLocaleString("en-US")} ${schedule?.currency ?? "EGP"}`
                      : t("site.booking.consultationFee")}
                  </p>
                  <p className="mt-1 text-xs text-ink/50">
                    {t("site.booking.bookingQueueRef", { id: confirmation.id, number: confirmation.queue_number })}
                  </p>
                </div>

                {payError && (
                  <div className="rounded-xl border border-[#a83b2d]/20 bg-[#a83b2d]/10 p-3.5 text-xs text-[#a83b2d]">
                    {payError}
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setStep("payment")}
                    disabled={payingOnline}
                    className="inline-flex items-center gap-2 rounded-full border border-ink/15 px-6 py-3.5 text-xs font-medium uppercase tracking-[0.2em] text-ink/70 transition-colors hover:text-ink disabled:opacity-40"
                  >
                    <ArrowLeft className="h-4 w-4" /> {t("site.booking.back")}
                  </button>
                  <button
                    type="button"
                    onClick={handleSimulatedPayment}
                    disabled={payingOnline}
                    className="group inline-flex items-center justify-center gap-2 rounded-full bg-ink px-8 py-4 text-xs font-medium uppercase tracking-[0.2em] text-cream transition-all duration-300 hover:bg-ink/85 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {payingOnline ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> {t("site.booking.processing")}
                      </>
                    ) : (
                      <>
                        {t("site.booking.simulatePayment")}
                        <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* ── STEP 4: CONFIRMATION ────────────────────────────────────────── */}
            {step === "confirmed" && confirmation && (
              <div ref={successRef} tabIndex={-1} className="outline-none">
                <span className="grid h-14 w-14 place-items-center rounded-full bg-gold text-ink shadow-md">
                  <Check className="h-7 w-7" strokeWidth={2.5} />
                </span>
                <h2 className="mt-6 font-serif text-3xl font-medium tracking-tight text-ink sm:text-4xl">
                  {t("site.booking.bookingConfirmed")}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-ink/60">
                  {t("site.booking.thankYou", { name: fields.fullName })}
                </p>

                <div className="mt-6 grid grid-cols-2 gap-4 rounded-xl border border-ink/10 bg-cream/60 p-5 sm:grid-cols-3">
                  <div>
                    <span className="block text-[0.62rem] uppercase tracking-wider text-ink/40">{t("site.booking.date")}</span>
                    <span className="font-serif text-base font-medium text-ink">{formatDateLong(confirmation.date, locale)}</span>
                  </div>
                  <div>
                    <span className="block text-[0.62rem] uppercase tracking-wider text-ink/40">{t("site.booking.service2")}</span>
                    <span className="font-serif text-base font-medium text-ink">{treatmentLabel(confirmation.treatment)}</span>
                  </div>
                  <div>
                    <span className="block text-[0.62rem] uppercase tracking-wider text-ink/40">{t("site.booking.queueNumber")}</span>
                    <span className="font-serif text-base font-medium text-gold">#{confirmation.queue_number}</span>
                  </div>
                  {confirmation.consultation_fee != null && confirmation.consultation_fee > 0 && (
                    <div>
                      <span className="block text-[0.62rem] uppercase tracking-wider text-ink/40">
                        {confirmation.service_type === "consultation"
                          ? t("site.booking.consultationPriceLabel")
                          : t("site.booking.consultationFeeLabel")}
                      </span>
                      <span className="font-serif text-base font-medium text-ink">
                        {confirmation.consultation_fee.toLocaleString("en-US")} {schedule?.currency ?? "EGP"}
                      </span>
                    </div>
                  )}
                  {confirmation.branch_name && (
                    <div>
                      <span className="block text-[0.62rem] uppercase tracking-wider text-ink/40">{t("site.booking.branchLabel")}</span>
                      <span className="font-serif text-base font-medium text-ink">{confirmation.branch_name}</span>
                    </div>
                  )}
                  <div>
                    <span className="block text-[0.62rem] uppercase tracking-wider text-ink/40">{t("site.booking.patientsAhead")}</span>
                    <span className="font-serif text-base font-medium text-ink">{patientsAhead}</span>
                  </div>
                  <div>
                    <span className="block text-[0.62rem] uppercase tracking-wider text-ink/40">{t("site.booking.estimatedArrival")}</span>
                    <span className="font-serif text-base font-medium text-ink">
                      {formatTimeRange(estimatedStart, estimatedEnd, t("site.booking.toBeConfirmed"))}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[0.62rem] uppercase tracking-wider text-ink/40">{t("site.booking.payment")}</span>
                    <span className="font-serif text-base font-medium text-ink">
                      {confirmation.payment_method === "online" ? t("site.booking.paidOnline") : t("site.booking.payAtClinic")}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[0.62rem] uppercase tracking-wider text-ink/40">{t("site.booking.paymentStatus")}</span>
                    <span
                      className={`inline-block mt-0.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        confirmation.payment_status === "paid"
                          ? "bg-emerald-500/15 text-emerald-800"
                          : "bg-amber-500/15 text-amber-800"
                      }`}
                    >
                      {confirmation.payment_status === "paid" ? t("site.booking.paid") : t("site.booking.pending")}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[0.62rem] uppercase tracking-wider text-ink/40">{t("site.booking.status")}</span>
                    <span className="font-serif text-base font-medium capitalize text-ink">{confirmation.status}</span>
                  </div>
                </div>

                <p className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-ink/50">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" />
                  {t("site.booking.arrivalDisclaimer")}
                </p>

                <div className="mt-4 flex items-center gap-2 text-xs text-ink/40">
                  <Building2 className="h-3.5 w-3.5" />
                  <span>{t("site.booking.bookingReference", { id: confirmation.id })}</span>
                </div>

                <div className="mt-8 flex flex-wrap items-center gap-4">
                  <button
                    type="button"
                    onClick={resetFlow}
                    className="text-xs font-medium uppercase tracking-[0.2em] text-ink underline-offset-4 hover:underline"
                  >
                    {t("site.booking.bookAnother")}
                  </button>
                  <Link
                    href="/"
                    className="text-xs font-medium uppercase tracking-[0.2em] text-ink/50 underline-offset-4 hover:text-ink hover:underline"
                  >
                    {t("site.booking.returnHome")}
                  </Link>
                </div>
              </div>
            )}
          </div>

          {step === "date" && (
            <p className="mt-6 flex items-center gap-2 text-xs text-ink/40">
              <CalendarIcon className="h-3.5 w-3.5" />
              {t("site.booking.workingDaysNote", {
                window: schedule ? t("site.booking.bookingWindowSuffix", { days: schedule.booking_window_days }) : "",
              })}
            </p>
          )}

          {/* Single exit out of the focused booking flow. Hidden once the
              booking is confirmed — at that point leaving cancels nothing. */}
          {step !== "confirmed" && (
            <div className="mt-10 border-t border-ink/10 pt-6">
              <p className="flex items-start gap-2 text-xs leading-relaxed text-[#a83b2d]">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {t("site.booking.cancelWarning")}
              </p>
              <Link
                href="/"
                className="mt-4 inline-flex items-center gap-2 rounded-full border border-ink/15 px-6 py-3.5 text-xs font-medium uppercase tracking-[0.2em] text-ink/70 transition-colors hover:border-ink/30 hover:text-ink"
              >
                <ArrowLeft className="h-4 w-4" /> {t("site.booking.backToHome")}
              </Link>
            </div>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
