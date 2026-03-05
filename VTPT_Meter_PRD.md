# VTPT Meter — Product Requirements Document (PRD)
Version 6.0 | March 2026

---

## Quick Summary
- **App Name:** VTPT Meter
- **Type:** Mobile-first web app (used in phone browser)
- **Team:** Small team — regular users + admins
- **Languages:** Vietnamese + English (supports Vietnamese characters)
- **Timezone:** All timestamps use Vietnamese time (UTC+7) — everywhere in the app
- **Session:** PIN session only — closes when browser tab closes
- **Goal:** Rebuild from Google Sheets + Apps Script into a stable, reliable web app using React + Supabase

---

## 1. Problem Statement
Current system uses Google Sheets + Google Apps Script. Problems:
- Race conditions: record starts saving in background while team moves on — causes duplicate/ghost entries
- Delete conflicts: deleting a row while it's still saving causes the same row to reappear
- Unstable sync: UI moves faster than backend can process
- Wrong tool: Google Sheets is a spreadsheet, not a real-time database

**Goal: Replace with a proper database (Supabase) and a clean, stable React web app.**

---

## 2. User Roles

### Regular User
- Logs in with a 4-digit PIN
- Can navigate houses and rooms
- Can record electric and water readings for current cycle
- Can edit and delete any reading (history table is fully interactive for all users)
- Can view reading history and room log

### Admin User
- Logs in with an admin-level 4-digit PIN
- Admin badge shown on home screen after login
- All regular user permissions PLUS:
  - Create and close billing cycles
  - Manage users and their PINs

---

## 3. House & Room Structure
Total: 73 rooms across 7 houses

| House | Rooms | Count |
|-------|-------|-------|
| A0 | A0-01 to A0-06 | 6 |
| A1 | A1-01 to A1-12 | 12 |
| A2 | A2-01 to A2-05 | 5 |
| A3 | A3-01 to A3-13 | 13 |
| A4 | A4-01 to A4-09 | 9 |
| A5 | A5-01 to A5-14 | 14 |
| A6 | A6-01 to A6-14 | 14 |

---

## 4. App Screens & Flow

### Screen 1 — Login Page
- App title: VTPT Meter
- Subtitle: Enter your 4-digit PIN
- 4 individual PIN input boxes (one digit each)
- Tip: you can paste all digits at once
- Unlock button (dark, full-width)
- Note: Session only — closes when tab closes
- Clear button to reset PIN entry

### Screen 2 — House Selection (Home)
- Large title: VTPT Meter
- Subtitle shows: current Cycle (e.g. 2026-03) + cached timestamp + Admin badge if admin
- Change button to switch user/PIN without full reload
- 7 house buttons as vertical list: A0, A1, A2, A3, A4, A5, A6

### Screen 3 — Room List (per House)
- Header: House name, Cycle, last updated timestamp
- Each room shown as a card with:
  - **Status icon** (driven by note field):
    - No icon = not recorded yet
    - 🟡 Yellow = recorded AND note has content (flags an issue, e.g. "thay đồng hồ")
    - 🟢 Green = recorded with no note, OR note contains "resolved" (issue fixed)
    - Example: Điện 1234 Nước 456 note "thay đồng hồ" → Yellow icon
    - Example: Điện 1234 Nước 456 note "thay đồng hồ. resolved" → Green icon
  - Room ID (e.g. A3-01)
  - Điện (Electric) label + current cycle value (or --- if not recorded)
  - Nước (Water) label + current cycle value (or --- if not recorded)

### Screen 4 — Room Detail
- Header: Room ID, last recorded timestamp, cycle ID
- **Section: Current Cycle Reading**
  - Electric Meter card: shows saved value in large font + kWh unit
  - Water Meter card: shows saved value in large font + m³ unit
  - Tapping either card opens the Record Reading modal
- **Section: History**
  - 3 tabs: Electric | Water | Log
  - Electric and Water tabs: table with Date | Value | Difference columns
  - Difference shown in green with + prefix (e.g. +84)
  - First/oldest entry shows -- for Difference (no previous to compare)
  - Tapping any row opens a popup with Edit and Delete options — available to ALL users
  - Edit popup pre-fills existing Điện, Nước, and Note values
  - Delete asks for confirmation before removing

### Screen 5 — Record Reading Modal (Popup)
- Slides up as a modal over Room Detail (background dims)
- Title: Record reading
- Close (x) button top right
- Input: Điện (Electric) — pre-filled if already recorded
- Input: Nước (Water) — pre-filled if already recorded
- Input: Note (optional) — placeholder: "ie. thay đồng hồ điện"
- Buttons: Cancel | Save
- Save must fully complete before modal closes — zero background saving

### Screen 6 — Log Tab
- Title: Room Log + Refresh button
- Each entry: [Username  Date  Time]  ACTION  details
- ADD entry shows: dien=  nuoc=  note= (if present). No cycle shown.
- DELETE entry shows: date=  dien=  nuoc=. No cycle, no ID shown.
- Sorted newest first

---

## 5. Data Structure
Mirrors current Google Sheet columns: Room | Date | Điện | Nước | ID | Notes | Cycle

| Table | Fields |
|-------|--------|
| Users | PIN (4-digit), display name, role (user/admin), created date |
| Cycles | Cycle ID (e.g. 2026-03), status (active/closed), created by, open/close dates |
| Houses | House ID (A0-A6) |
| Rooms | Room ID (e.g. A0-01), house ID |
| Readings | Room, Date, Điện, Nước, ID (auto-increment for sorting, not shown to users), Notes, Cycle |
| Logs | Room, action (ADD/DELETE), user, timestamp, reading snapshot |

---

## 6. Non-Functional Requirements
- Mobile-first: designed for phone screens, large tap targets
- Vietnamese support: all UI and inputs support Vietnamese characters
- Modern font: clean sans-serif (e.g. Inter or Be Vietnam Pro)
- Vietnamese timezone: UTC+7 used everywhere
- Reliable saving: save confirmation required before navigation — no race conditions
- Status icons must update immediately after saving
- Session management: PIN session only, no persistent login

---

## 7. MVP — Build First

| Feature | Description |
|---------|-------------|
| PIN Login | 4-digit PIN, identifies role, session only |
| House Selection | 7 house buttons with current cycle shown |
| Room List | Rooms per house with Điện + Nước values and 3-state status icon |
| Room Detail | Shows current cycle reading for Electric and Water |
| Record Reading | Modal popup with Điện, Nước, Note fields + reliable Save |
| History Table | Electric and Water tabs — Date, Value, Difference — tap row to edit/delete |
| Log Tab | Room action log — ADD/DELETE with user + timestamp |
| Active Cycle | One active cycle at a time, shown on all screens |
| Admin: Cycle | Admin can create and close billing cycles |
| Admin: PINs | Admin can add and remove user PINs |

### Post-MVP (add later)
- Export to PDF or Excel
- Offline support
- Dashboard/summary view across all houses

---

## 8. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React.js |
| Styling | Tailwind CSS |
| Database | Supabase (replaces Google Sheets) |
| Auth | Supabase with PIN-based custom auth |
| Hosting | Vercel |
| AI Help | Claude Code in VSCode |
