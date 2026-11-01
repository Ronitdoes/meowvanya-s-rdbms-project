# CampusConnect Frontend Conventions

The foundation is built. Do not redesign it; extend it.

## Stack

Vite 8 · React 19 · TypeScript 7 · Tailwind CSS 4 · React Router 7 · TanStack Query 5
· React Hook Form 7 · Zod 4 · Lucide React · Recharts 3 · Sonner.

Commands from `frontend/`:

```bash
npm run build     # tsc -b && vite build — MUST pass
npm run dev       # dev server on :5173, proxies /api to :8080
```

There is no local database/server running. Verify with `npm run build` only.

## Data access

Use `@/services/api`:

```ts
import { api, ApiError, errorMessage } from '@/services/api'
const clubs = await api.get<Club[]>('/clubs')
const page = await api.list<Club>('/clubs', { page, pageSize: 12, search })
await api.post<MembershipRequest>(`/clubs/${id}/join`)
await api.patch<Event>(`/events/${id}`, body)
await api.delete(`/registrations/${id}`)
```

- `api.list` returns `{ data, meta }`; use `meta.totalPages` with `Pagination`.
- Types live in `@/types` — extend only if genuinely missing.
- Show errors with the message from `ApiError`; map `error.fields` to form fields.
- Use TanStack Query: `useQuery({ queryKey: [...], queryFn })`, `useMutation` +
  `queryClient.invalidateQueries({ queryKey: [...] })`. Keep query keys descriptive.
- Never call `fetch` directly.

## Auth

`useAuth()` from `@/context/AuthContext` gives `{ user, login, register, logout, refresh, setUser }`.
Cookies are handled by the API service. Role guards already protect routes.
Backend enforces authorization; do not build security decisions client-side beyond UX.

## Routing

Routes are already registered in `src/App.tsx`. Do not edit it.
Student paths: `/student/dashboard|clubs|clubs/:id|events|events/:id|registrations|certificates`.
Coordinator: `/coordinator/dashboard|events|events/new|events/:id/edit|events/:id/attendance|members`.
Admin: `/admin/dashboard|students|clubs|events|venues|departments`. Shared: `/profile`.

## Design system

- Page shell: `<PageHeader eyebrow title description actions backTo />` from
  `@/components/shared/PageChrome`. Titles use the display serif; keep them short.
- Cards: `Card`, `CardHeader`, `CardContent`, `CardFooter` from `@/components/ui/Card`.
- Buttons: `Button` (`primary`, `secondary`, `ghost`, `danger`, `dark`, `acid`; sizes
  `sm|md|lg|icon`); for links use `buttonStyles({...})` + `<Link className={...}>`.
- Badges: `Badge`, `StatusBadge`, `RoleBadge`.
- Forms: `Input`, `Select`, `Textarea` from `@/components/ui/Input` — they provide
  labels, hints and errors. Use React Hook Form + Zod. Server field errors map to
  `setError`.
- Tables: `TableWrapper/Table/THead/TBody/TR/TH/TD/TableEmpty` from ui/Table.
- Dialog: `Modal`, `ConfirmDialog`. Pagination: `Pagination`. Search: `SearchInput`.
- Empty/loading/error: `EmptyState`, `ErrorState`, `Skeleton`, `ListSkeleton`.
- Event cards: `EventCard`; club cards: `ClubCard`; avatars: `Avatar`; ratings:
  `StarRating`, `StarRatingInput`; capacity: `CapacityBar`.
- Icons: lucide-react, 16–18px inline. Do not add emoji.
- Colours: `ink-*`, `brand-*`, `paper`, `acid-*`, `sun-*`. Prefer white cards on
  `bg-paper`. Use rounded-3xl cards, rounded-full pills/buttons. Avoid pure black.
- Motion: subtle hover lift and the built-in `animate-fade-up`; no excessive animation.
- Always handle loading, empty, error and mobile layouts. Tables scroll horizontally.

## Toast

`import { toast } from 'sonner'`; success messages on mutations, error messages
from caught errors. Keep copy concise.

## Conventions

- Function components only; one default export page per file.
- Use `usePageTitle('…')` in every page.
- Dates: `formatDate`, `formatDateTime`, `formatTime`, `eventDateLabel`, `relativeTime`
  from `@/lib/utils`; never hand-roll date formatting.
- `cn()` for conditional classes.
- No `any`, no unused imports, no `@ts-ignore`. Strict TS must pass.
- Do not edit foundation files (`App.tsx`, `main.tsx`, `types/`, `services/`, `lib/`,
  `context/`, `routes/`, `components/**`) unless your assignment explicitly owns them.
  If a shared component truly needs a prop, report it instead of editing.
- Do not add npm dependencies unless unavoidable and approved.
- Accessibility: label controls, alt text for meaningful images, keyboard-friendly
  dialogs, button `aria-label` for icon-only actions.

## File ownership for page agents

Student pages: `src/pages/student/{ClubsPage,ClubDetailPage,EventsPage,EventDetailPage,RegistrationsPage,CertificatesPage}.tsx`.
Coordinator pages: `src/pages/coordinator/{DashboardPage,EventsPage,EventFormPage,MembersPage,AttendancePage}.tsx`.
Admin pages: `src/pages/admin/{DashboardPage,StudentsPage,ClubsPage,EventsPage,VenuesPage,DepartmentsPage}.tsx`.

`DashboardPage.tsx` for students is already built — do not touch it.

## API quirks to handle

- List responses use the envelope/meta described above.
- Event statuses: `draft|pending|published|rejected|completed|cancelled`.
- Registration statuses: `confirmed|cancelled|waitlisted`.
- A coordinator manages only clubs returned by `/me/coordinated-clubs`.
- Student event registration/cancellation affects `/me/registrations` and event counts;
  invalidate both.
- Certificates are issued when attendance is marked present. The download flow is
  client-side (generate a printable HTML/text file); there is no PDF endpoint.
- Some endpoints may return 403/409 for business rules; surface the API message.
