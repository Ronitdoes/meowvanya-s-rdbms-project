import { useDeferredValue, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  ClipboardList,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, errorMessage } from '@/services/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import { cn, formatDate, pluralize } from '@/lib/utils'
import type { Club, ClubMember, MembershipStatus } from '@/types'
import { EmptyState, ErrorState, PageHeader, SearchInput } from '@/components/shared/PageChrome'
import { Avatar } from '@/components/shared/Avatar'
import { Pagination } from '@/components/shared/Pagination'
import { Badge, StatusBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { Select } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/ui/Modal'
import { ListSkeleton, PageSkeleton } from '@/components/ui/Skeleton'
import {
  Table,
  TableWrapper,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '@/components/ui/Table'

type StatusTab = 'pending' | 'approved' | 'rejected' | 'all'
type DecisionStatus = Exclude<MembershipStatus, 'pending'>
type MemberRole = ClubMember['role']

interface DecisionVariables {
  clubId: number
  membershipId: number
  status: DecisionStatus
}

interface RoleVariables {
  clubId: number
  membershipId: number
  role: MemberRole
}

interface RemoveVariables {
  clubId: number
  membershipId: number
  fullName: string
}

const statusTabs: Array<{ value: StatusTab; label: string }> = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All' },
]

export default function CoordinatorMembersPage() {
  usePageTitle('Members')
  const queryClient = useQueryClient()

  const [selectedClubId, setSelectedClubId] = useState<number | null>(null)
  const [status, setStatus] = useState<StatusTab>('pending')
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [page, setPage] = useState(1)
  const [memberToRemove, setMemberToRemove] = useState<ClubMember | null>(null)
  const [pendingRoleChange, setPendingRoleChange] = useState<RoleVariables | null>(null)

  const clubsQuery = useQuery({
    queryKey: ['coordinated-clubs'],
    queryFn: () => api.get<Club[]>('/me/coordinated-clubs'),
  })

  const clubs = clubsQuery.data ?? []
  // Default to the first coordinated club so the roster is visible straight away.
  const activeClub = clubs.find((club) => club.clubId === selectedClubId) ?? clubs[0]

  const membersQuery = useQuery({
    queryKey: ['club-members', activeClub?.clubId, status, deferredSearch, page],
    queryFn: () =>
      api.list<ClubMember>(`/clubs/${activeClub?.clubId}/members`, {
        status: status === 'all' ? undefined : status,
        search: deferredSearch,
        page,
        pageSize: 10,
      }),
    enabled: Boolean(activeClub?.clubId),
    placeholderData: keepPreviousData,
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['club-members'] })
    void queryClient.invalidateQueries({ queryKey: ['coordinator-dashboard'] })
    void queryClient.invalidateQueries({ queryKey: ['clubs'] })
    void queryClient.invalidateQueries({ queryKey: ['coordinated-clubs'] })
  }

  const decide = useMutation({
    mutationFn: ({ clubId, membershipId, status: nextStatus }: DecisionVariables) =>
      api.patch<ClubMember>(`/clubs/${clubId}/members/${membershipId}`, {
        status: nextStatus,
      }),
    onSuccess: (_member, variables) => {
      toast.success(variables.status === 'approved' ? 'Membership approved' : 'Request rejected')
      invalidate()
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const changeRole = useMutation({
    mutationFn: ({ clubId, membershipId, role }: RoleVariables) =>
      api.patch<ClubMember>(`/clubs/${clubId}/members/${membershipId}/role`, { role }),
    onSuccess: (_member, variables) => {
      toast.success(variables.role === 'coordinator' ? 'Promoted to coordinator' : 'Changed to member')
      setPendingRoleChange(null)
      invalidate()
    },
    onError: (error) => {
      toast.error(errorMessage(error))
      setPendingRoleChange(null)
    },
  })

  const remove = useMutation({
    mutationFn: ({ clubId, membershipId }: RemoveVariables) =>
      api.delete(`/clubs/${clubId}/members/${membershipId}`),
    onSuccess: (_result, variables) => {
      toast.success(`${variables.fullName} was removed from the club`)
      setMemberToRemove(null)
      invalidate()
    },
    onError: (error) => {
      toast.error(errorMessage(error))
      setMemberToRemove(null)
    },
  })

  const changeStatus = (next: StatusTab) => {
    setStatus(next)
    setPage(1)
  }

  const changeSearch = (value: string) => {
    setSearch(value)
    setPage(1)
  }

  if (clubsQuery.isLoading) {
    return (
      <div className="space-y-7">
        <PageHeader eyebrow="Coordinator studio" title="Members" />
        <PageSkeleton />
      </div>
    )
  }

  if (clubsQuery.isError) {
    return (
      <div className="space-y-7">
        <PageHeader eyebrow="Coordinator studio" title="Members" />
        <ErrorState
          title="We could not load your clubs"
          message={errorMessage(clubsQuery.error)}
          onRetry={() => clubsQuery.refetch()}
        />
      </div>
    )
  }

  if (clubs.length === 0) {
    return (
      <div className="space-y-7">
        <PageHeader
          eyebrow="Coordinator studio"
          title="Members"
          description="Review requests and keep your club rosters tidy."
        />
        <Card>
          <EmptyState
            icon={<Users className="h-6 w-6" />}
            title="No clubs to manage yet"
            description="An administrator must assign you as a club coordinator before member requests appear here."
          />
        </Card>
      </div>
    )
  }

  const rows = membersQuery.data?.data ?? []
  const meta = membersQuery.data?.meta
  const isDeciding = (membershipId: number) =>
    decide.isPending && decide.variables?.membershipId === membershipId
  const isChangingRole = (membershipId: number) =>
    changeRole.isPending && changeRole.variables?.membershipId === membershipId

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Coordinator studio"
        title="Members"
        description="Approve join requests, adjust roles and keep each roster accurate."
      />

      <Card>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="w-full sm:max-w-xs">
            <Select
              label="Club"
              value={activeClub?.clubId ?? ''}
              onChange={(event) => {
                setSelectedClubId(Number(event.target.value))
                setPage(1)
                setSearch('')
              }}
            >
              {clubs.map((club) => (
                <option key={club.clubId} value={club.clubId}>
                  {club.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="success">{activeClub?.approvedMembers ?? 0} approved</Badge>
            <Badge tone={(activeClub?.pendingRequests ?? 0) > 0 ? 'warning' : 'neutral'}>
              {activeClub?.pendingRequests ?? 0} pending
            </Badge>
            <Badge tone="info">{activeClub?.status ?? 'approved'}</Badge>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div
          className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 no-scrollbar"
          role="tablist"
          aria-label="Membership status"
        >
          {statusTabs.map((tab) => {
            const active = tab.value === status
            const count =
              tab.value === 'pending'
                ? activeClub?.pendingRequests
                : tab.value === 'approved'
                  ? activeClub?.approvedMembers
                  : undefined
            return (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => changeStatus(tab.value)}
                className={cn(
                  'shrink-0 rounded-full px-3.5 py-2 text-xs font-semibold transition-colors',
                  active
                    ? 'bg-ink-950 text-white shadow-sm'
                    : 'border border-ink-200 bg-white text-ink-500 hover:border-ink-300 hover:text-ink-800',
                )}
              >
                {tab.label}
                {typeof count === 'number' ? (
                  <span className={cn('ml-1.5', active ? 'text-acid-300' : 'text-ink-400')}>{count}</span>
                ) : null}
              </button>
            )
          })}
        </div>
        <SearchInput
          value={search}
          onChange={changeSearch}
          placeholder="Search name, email or enrollment…"
          className="w-full lg:w-80"
        />
      </div>

      <Card className="overflow-hidden">
        {membersQuery.isError ? (
          <ErrorState
            title="We could not load this roster"
            message={errorMessage(membersQuery.error)}
            onRetry={() => membersQuery.refetch()}
          />
        ) : membersQuery.isLoading && !membersQuery.data ? (
          <div className="p-6">
            <ListSkeleton rows={5} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="h-6 w-6" />}
            title={
              deferredSearch
                ? 'No members match your search'
                : status === 'pending'
                  ? 'No pending requests'
                  : status === 'approved'
                    ? 'No approved members yet'
                    : status === 'rejected'
                      ? 'No rejected requests'
                      : 'No members yet'
            }
            description={
              deferredSearch
                ? 'Try a name, email address or enrollment number.'
                : status === 'pending'
                  ? 'New join requests from students will appear here.'
                  : 'This roster will fill up as students join your club.'
            }
            action={
              deferredSearch ? (
                <Button variant="secondary" size="sm" onClick={() => changeSearch('')}>
                  Clear search
                </Button>
              ) : undefined
            }
          />
        ) : (
          <TableWrapper>
            <Table>
              <THead>
                <TR>
                  <TH>Member</TH>
                  <TH>Enrollment</TH>
                  <TH>Department</TH>
                  <TH>Role</TH>
                  <TH>Status</TH>
                  <TH>Timeline</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((member) => {
                  const deciding = isDeciding(member.membershipId)
                  const roleBusy = isChangingRole(member.membershipId)
                  return (
                    <TR key={member.membershipId}>
                      <TD>
                        <div className="flex min-w-[180px] items-center gap-3">
                          <Avatar name={member.fullName} size="sm" />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-ink-900">{member.fullName}</p>
                            <p className="truncate text-xs text-ink-400">{member.email}</p>
                          </div>
                        </div>
                      </TD>
                      <TD className="whitespace-nowrap font-mono text-xs text-ink-600">
                        {member.enrollmentNumber}
                      </TD>
                      <TD className="whitespace-nowrap text-xs">{member.departmentName}</TD>
                      <TD>
                        <Badge tone={member.role === 'coordinator' ? 'brand' : 'neutral'}>
                          {member.role === 'coordinator' ? (
                            <ShieldCheck className="h-3 w-3" />
                          ) : (
                            <UserRound className="h-3 w-3" />
                          )}
                          {member.role}
                        </Badge>
                      </TD>
                      <TD>
                        <StatusBadge status={member.status} />
                      </TD>
                      <TD className="whitespace-nowrap text-[0.6875rem] leading-relaxed text-ink-500">
                        <p>Requested {formatDate(member.requestedAt, 'd MMM yyyy')}</p>
                        {member.joinedAt ? <p>Joined {formatDate(member.joinedAt, 'd MMM yyyy')}</p> : null}
                      </TD>
                      <TD>
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {member.status === 'pending' ? (
                            <>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() =>
                                  decide.mutate({
                                    clubId: member.clubId,
                                    membershipId: member.membershipId,
                                    status: 'rejected',
                                  })
                                }
                                loading={deciding && decide.variables?.status === 'rejected'}
                                disabled={decide.isPending && !(deciding && decide.variables?.status === 'rejected')}
                                leftIcon={<X className="h-3.5 w-3.5" />}
                              >
                                Reject
                              </Button>
                              <Button
                                size="sm"
                                onClick={() =>
                                  decide.mutate({
                                    clubId: member.clubId,
                                    membershipId: member.membershipId,
                                    status: 'approved',
                                  })
                                }
                                loading={deciding && decide.variables?.status === 'approved'}
                                disabled={decide.isPending && !(deciding && decide.variables?.status === 'approved')}
                                leftIcon={<Check className="h-3.5 w-3.5" />}
                              >
                                Approve
                              </Button>
                            </>
                          ) : null}

                          {member.status === 'approved' ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              loading={roleBusy}
                              onClick={() =>
                                setPendingRoleChange({
                                  clubId: member.clubId,
                                  membershipId: member.membershipId,
                                  role: member.role === 'coordinator' ? 'member' : 'coordinator',
                                })
                              }
                              leftIcon={
                                member.role === 'coordinator' ? (
                                  <UserRound className="h-3.5 w-3.5" />
                                ) : (
                                  <ShieldCheck className="h-3.5 w-3.5" />
                                )
                              }
                            >
                              {member.role === 'coordinator' ? 'Make member' : 'Make coordinator'}
                            </Button>
                          ) : null}

                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-9 w-9 text-ink-400 hover:text-rose-600"
                            onClick={() => setMemberToRemove(member)}
                            aria-label={`Remove ${member.fullName}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          </TableWrapper>
        )}
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-ink-400">
          {meta ? pluralize(meta.total, 'member') : `${rows.length} members`}
          {status !== 'all' ? <span className="text-ink-500"> · {status}</span> : null}
        </p>
        {meta ? (
          <Pagination meta={meta} onPageChange={setPage} label="members" className="flex-1 justify-end" />
        ) : null}
      </div>

      <ConfirmDialog
        open={Boolean(memberToRemove)}
        onClose={() => (remove.isPending ? undefined : setMemberToRemove(null))}
        onConfirm={() => {
          if (memberToRemove) {
            remove.mutate({
              clubId: memberToRemove.clubId,
              membershipId: memberToRemove.membershipId,
              fullName: memberToRemove.fullName,
            })
          }
        }}
        title="Remove this member?"
        description={
          memberToRemove
            ? `${memberToRemove.fullName} will lose access to ${memberToRemove.clubName}. They can request to join again later.`
            : undefined
        }
        confirmLabel="Remove member"
        tone="danger"
        loading={remove.isPending}
      />

      <ConfirmDialog
        open={Boolean(pendingRoleChange)}
        onClose={() => (changeRole.isPending ? undefined : setPendingRoleChange(null))}
        onConfirm={() => {
          if (pendingRoleChange) changeRole.mutate(pendingRoleChange)
        }}
        title={pendingRoleChange?.role === 'coordinator' ? 'Make this member a coordinator?' : 'Change to member?'}
        description={
          pendingRoleChange?.role === 'coordinator'
            ? 'Coordinators can manage events and membership for this club. A club must keep at least one coordinator.'
            : 'They will keep their membership but lose coordinator management access.'
        }
        confirmLabel={pendingRoleChange?.role === 'coordinator' ? 'Make coordinator' : 'Change to member'}
        loading={changeRole.isPending}
      />
    </div>
  )
}
