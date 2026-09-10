<div align="center">

# ✨ Èlan Studio

### A full‑stack dental clinic platform — marketing site, queue‑based booking, and a staff admin dashboard

![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=for-the-badge&logo=next.js&logoColor=white)
![React](https://img.shields.io/badge/React-19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?style=for-the-badge&logo=fastapi&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.12-3776AB?style=for-the-badge&logo=python&logoColor=white)
![SQLAlchemy](https://img.shields.io/badge/SQLAlchemy-2.0-D71F00?style=for-the-badge)

</div>

> ⚠️ **Demo project.** Clinic name, doctor profile, reviews, and imagery are fictional placeholders for presentation purposes.

---

## ✨ Overview

Èlan Studio is a two-part project:

- **`frontend/`** — a Next.js marketing site with an immersive 3D hero, plus a public **queue-based booking flow** and a full **staff/admin dashboard**.
- **`backend/`** — a FastAPI service that owns every business rule: queue assignment, arrival/working-hours checks, payment state, and auth. The frontend never computes any of this itself — it only displays what the API returns, and falls back to a local demo store if the API is unreachable.

There are no fixed appointment time slots. A patient picks a **day**; the backend assigns the next **queue number** for that day and estimates an arrival window from the clinic's configured consultation duration — first-come, first-served, like a real walk-in queue.

---

## 🌟 Features

### Public site
- 🦷 Immersive 3D hero (React Three Fiber), cinematic GSAP/Lenis scroll, editorial sections (treatments, before/after, testimonials, FAQ…).
- 📅 **Booking form** — patients submit name/phone/treatment/date; the backend returns a queue number and estimated arrival window, with live queue-status polling on the confirmation screen.
- 💳 Simulated online payment, or "pay at clinic."

### Staff / Admin dashboard (`/admin`)
- 🔐 JWT login (`admin` / `staff` roles).
- 🗓️ **Day Agenda** — one day's queue at a time, with a scrollable date-pill picker (arrow buttons, mouse wheel, or drag), live queue/status/arrival/payment badges per patient.
- 📋 **All Bookings** table — filter by status, month, year, or date preset; search by name/phone/treatment.
- 🩺 **Consultations** view — consultation requests, plus completed exams whose patient also has a pending consultation follow-up.
- 🧾 **Extra charges** — staff can bill add-on work (e.g. a crown or filling done after the exam) on top of the base appointment, with an amount, a note, and a paid/unpaid flag. Shows as a badge everywhere that booking appears.
- 👤 **Patient Record** — full visit history for a patient (matched by phone across bookings), with per-visit status updates and extra-charge management.
- ✅ Arrival tracking ("Mark as Entered"), enforced server-side to the booking's date and the clinic's working hours.
- 📲 WhatsApp reminders for patients whose turn is approaching (no-ops until a WhatsApp Cloud API account is configured).

---

## 🛠️ Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend framework | **Next.js 16** (App Router) · **React 19** · **TypeScript 5** |
| Styling | **Tailwind CSS 4** |
| 3D / Animation | **Three.js** · **@react-three/fiber** · **GSAP** (ScrollTrigger) · **Lenis** (smooth scroll) |
| Backend framework | **FastAPI** · **Python 3.12** |
| Database | **SQLite** locally / **PostgreSQL** (Supabase) in production — both via **SQLAlchemy 2.0** + `psycopg`, selected entirely by `DATABASE_URL` (lightweight auto-migration on startup — no Alembic) |
| Auth | **JWT** (`python-jose`) + **bcrypt** (`passlib`) |
| Validation | **Pydantic v2** |
| Notifications | **WhatsApp Cloud API** (optional, via `httpx`) |

---

## 🚀 Getting Started

You need two terminals — one per service.

### 1) Backend (FastAPI)

```bash
cd backend
python -m venv venv && venv\Scripts\activate   # Windows; use `source venv/bin/activate` on macOS/Linux
pip install -r requirements.txt
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

The first run creates `backend/database.db` and seeds two default accounts:

| Username | Password | Role |
| --- | --- | --- |
| `admin` | `admin123` | Admin |
| `staff` | `staff123` | Staff |

API docs: **http://127.0.0.1:8000/docs**

#### Backend environment variables (`backend/.env`, all optional — see [`core/config.py`](backend/core/config.py) for defaults)

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Defaults to local SQLite (`sqlite:///./database.db`). In production this is set to a Supabase Postgres connection string — see "☁️ Deployment" below. Same code, no source change either way. |
| `SECRET_KEY` | JWT signing key — **set a real random value before deploying** |
| `CORS_ORIGINS` / `CORS_ORIGIN_REGEX` | Allowed frontend origins |
| `WHATSAPP_API_URL` / `WHATSAPP_API_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp Cloud API — reminders no-op until all three are set |

Copy [`backend/.env.example`](backend/.env.example) to `backend/.env` to get started — its defaults already match local SQLite, so it's optional unless you want to override something (e.g. WhatsApp credentials).

### 2) Frontend (Next.js)

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:3000** for the site, or **http://localhost:3000/admin** for the dashboard.

By default the frontend talks to `http://127.0.0.1:8000`; override with `NEXT_PUBLIC_API_URL` in `frontend/.env.local` if the backend runs elsewhere (see [`frontend/.env.local.example`](frontend/.env.local.example)). If the backend is unreachable, the admin dashboard falls back to a local `localStorage` demo store so the UI stays usable offline.

---

## 📁 Project Structure

```
work/
├─ frontend/                 # Next.js app
│  ├─ app/
│  │  ├─ admin/               # staff/admin dashboard (own layout.tsx — EN/AR + RTL)
│  │  ├─ (site)/               # public marketing site + booking (EN/AR, LTR only)
│  │  │  ├─ page.tsx
│  │  │  └─ booking/
│  │  └─ layout.tsx           # root layout — fonts, metadata, SmoothScroll
│  ├─ components/            # 3D hero, sections, layout, providers (Lenis/GSAP)
│  └─ lib/                   # API client (lib/api.ts), constants, i18n, animation helpers
│
└─ backend/                  # FastAPI service
   ├─ main.py                # app entrypoint, CORS, router registration
   ├─ routers/                # booking.py, auth.py, clinic.py — HTTP layer only
   ├─ services/               # business logic (booking_service, reminder_service, whatsapp_service)
   ├─ core/
   │  ├─ database.py         # SQLAlchemy models + lightweight auto-migration
   │  ├─ crud/                # DB query helpers
   │  ├─ clinic_schedule.py  # working days/hours source of truth
   │  ├─ security.py         # password hashing, JWT
   │  └─ dependencies.py     # get_db, require_staff, get_current_user
   └─ schemas/                # Pydantic request/response models
```

---

## ☁️ Deployment (Vercel + Railway + Supabase)

The frontend and backend deploy as two separate services against this **same repo** — nothing is forked or duplicated. Locally the backend runs on SQLite; in production it runs on Supabase Postgres. Both are the same code — only `DATABASE_URL` changes, via environment variables. See [`core/config.py`](backend/core/config.py) and [`core/database.py`](backend/core/database.py) for how that's wired.

### 1) Push to GitHub first
Both platforms deploy from a GitHub repo — make sure your latest commits are pushed to `origin/main` before starting either import below.

### 2) Create the production database → Supabase
1. On [supabase.com](https://supabase.com), create a new project (or reuse one).
2. **Settings → Database → Connection string**, pick the **Transaction pooler** (port `5432` or `6543` depending on plan) — the pooled connection is the one meant for a stateless web backend like this one. Copy it; it looks like:
   ```
   postgresql://postgres.<PROJECT_REF>:<PASSWORD>@aws-0-<REGION>.pooler.supabase.com:5432/postgres
   ```
3. **Do not** put this string in any file in the repo, the README, or a commit. It only ever goes into Railway's environment variables (next step). The database itself starts empty — the backend creates every table automatically on first startup (`Base.metadata.create_all`, see `core/database.py`); there's nothing to run manually in Supabase's SQL editor.

### 3) Backend → Railway
1. On [railway.app](https://railway.app), **New Project → Deploy from GitHub repo** → pick this repo.
2. In the service settings, set **Root Directory** to `backend`. Railway auto-detects Python via `requirements.txt` and uses `backend/Procfile` for the start command — no build config needed.
3. Add these environment variables on the service:
   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | the Supabase connection string from step 2 (**required** — omitting this falls back to local SQLite, which is not durable on Railway's filesystem) |
   | `SECRET_KEY` | a long random string (**required** — don't ship the default) |
   | `CORS_ORIGINS` | your Vercel URL once you have it, e.g. `https://your-app.vercel.app` |
   | `WHATSAPP_API_URL` / `WHATSAPP_API_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` | only if WhatsApp reminders are wired up for this deployment |
4. Deploy, then copy the generated public URL (Settings → Networking → Generate Domain) — you'll need it for the next step. Check the deploy logs for `✨ Èlan Studio API starting up …` with no traceback — that confirms `init_db()` connected to Supabase and created the schema successfully.

### 4) Frontend → Vercel
1. On [vercel.com](https://vercel.com), **Add New → Project** → import the same GitHub repo.
2. Set **Root Directory** to `frontend` in the import screen (or Project Settings → General afterward).
3. Add an environment variable: `NEXT_PUBLIC_API_URL` = the Railway backend URL from step 3.4 above (no trailing slash).
4. Deploy. Once it's live, go back to Railway and update `CORS_ORIGINS` to the real `https://your-app.vercel.app` domain Vercel just gave you, so the browser is actually allowed to call the API.

### Notes
- Redeploy the frontend after changing `NEXT_PUBLIC_API_URL` (Next.js inlines `NEXT_PUBLIC_*` vars at build time).
- The admin dashboard falls back to `http://127.0.0.1:8000` if `NEXT_PUBLIC_API_URL` isn't set — you'll see "Demo Mode"-style broken requests if it's missing in production.
- Supabase's dev/dev-branch data is a **separate database** from your local `backend/database.db` — local SQLite data is never automatically copied there. Seed accounts (`admin`/`staff`) are created fresh on Supabase the same way they are locally, by `_seed_default_users()` on first startup.
- **Uploaded medical images are not yet durable in production.** `backend/uploads/` is local disk — Railway's filesystem is ephemeral (wiped on every redeploy) unless a volume is attached, and even a volume doesn't survive moving to a different host. The database only stores the image's *filename/metadata* (`MedicalImage.filename`), not the file itself — that's already separated from the actual bytes on disk, which is what makes swapping the storage backend later a contained change. For real patient data in production, plan to move `services`/upload handling in `routers/medical_records.py` to write to Supabase Storage or S3 instead of the local `uploads/` directory before relying on this feature in production; this is not implemented in this change.

---

## 🔌 API Overview

Full interactive docs at `/docs`. Highlights:

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/bookings/` | Public | Submit a queue-based booking request |
| `GET` | `/bookings/{id}/queue-status` | Public | Live queue position (polled by the confirmation page) |
| `POST` | `/bookings/{id}/pay` | Public | Confirm simulated online payment |
| `GET` | `/bookings/` | Staff | List all bookings (`?status=`, `?date=`) |
| `PATCH` | `/bookings/{id}/status` | Staff | Update booking status |
| `PATCH` | `/bookings/{id}/arrival` | Staff | Mark patient as entered / not entered |
| `PATCH` | `/bookings/{id}/extra-charge` | Staff | Set/update an extra charge on a booking |
| `PATCH` | `/bookings/{id}/consultation-hint` | Staff | Show/hide the "has consultation" reminder |
| `DELETE` | `/bookings/{id}` | Staff | Delete a booking record |
| `POST` | `/bookings/reminders/dispatch` | Staff | Send due WhatsApp reminders (meant to be cron-driven) |
| `GET` | `/clinic/schedule` | Public | Working days/hours, consultation duration |
| `GET` | `/clinic/availability?date=` | Public | Queue preview for a candidate date |
| `POST` | `/auth/login` | Public | Get a JWT access token |
| `GET` | `/auth/me` | Authenticated | Current user info |

---

## 📝 Notes

- **SQLite locally, Postgres in production, one codebase** — there's no Alembic; `core/database.py` adds any missing columns to an existing SQLite `database.db` on startup, so upgrading the schema never requires dropping data. `DATABASE_URL` selects the dialect entirely — SQLite-only migration steps (e.g. the legacy queue-constraint upgrade) detect and skip themselves on Postgres, since a Postgres database only ever starts fresh with the complete current schema via `Base.metadata.create_all`.
- **No real payment gateway** — online payment is simulated; wiring a real provider (Stripe, Paymob, …) means replacing `confirm_online_payment` in `services/booking_service.py` with a signed webhook/callback.
- **One active booking per phone** — patients have no accounts; the phone number is the identity key, tolerant of formatting differences (leading zero / country code).
- **Placeholder content** — treatment imagery, the doctor profile, and testimonials on the public site are demo content built to be swapped 1:1 for real photography and copy.

