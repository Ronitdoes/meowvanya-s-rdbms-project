import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { SearchX, UserPlus, Users } from 'lucide-react'
import { toast } from 'sonner'
import { api, errorMessage } from '@/services/api'
import { usePageTitle } from '@/hooks/usePageTitle'
import type { Club, MembershipRequest } from '@/types'
import { EmptyState, ErrorState, PageHeader, SearchInput } from '@/components/shared/PageChrome'
import { ClubCard } from '@/components/shared/ClubCard'
import { Pagination } from '@/components/shared/Pagination'
import { Badge } from '@/components/ui/Badge'
import { Button, buttonStyles } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'

const PAGE_SIZE = 9

export default function StudentClubsPage() {
  usePageTitle('Clubs')
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [search])

  const clubs = useQuery({
    queryKey: ['clubs', debouncedSearch, page],
    queryFn: () =>
      api.list<Club>('/clubs', {
        search: debouncedSearch || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
  })

  const memberships = useQuery({
    queryKey: ['my-memberships'],
    queryFn: () => api.get<MembershipRequest[]>('/me/memberships'),
  })

  const membershipByClub = useMemo(() => {
    const map = new Map<number, MembershipRequest>()
    for (const membership of memberships.data ?? []) {
      map.set(membership.clubId, membership)
    }
    return map
  }, [memberships.data])

  const joinClub = useMutation({
    mutationFn: (club: Club) => api.post<MembershipRequest>(`/clubs/${club.clubId}/join`),
    onSuccess: (_membership, club) => {
      toast.success('Join request sent', {
        description: `Your request to join ${club.name} is waiting for coordinator review.`,
      })
      void queryClient.invalidateQueries({ queryKey: ['clubs'] })
      void queryClient.invalidateQueries({ queryKey: ['my-memberships'] })
      void queryClient.invalidateQueries({ queryKey: ['student-dashboard'] })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const renderActions = (club: Club) => {
    const membership = membershipByClub.get(club.clubId)
    const status = membership?.status ?? club.myStatus ?? null

    if (status === 'approved') {
      return (
        <Badge tone={membership?.role === 'coordinator' ? 'brand' : 'success'} dot>
          {membership?.role === 'coordinator' ? 'Coordinator' : 'Member'}
        </Badge>
      )
    }

    if (status === 'pending') {
      return (
        <Badge tone="warning" dot>
          Request pending
        </Badge>
      )
    }

    const joining = joinClub.isPending && joinClub.variables?.clubId === club.clubId

    return (
      <Button
        size="sm"
        onClick={() => joinClub.mutate(club)}
        loading={joining}
        leftIcon={<UserPlus className="h-3.5 w-3.5" />}
      >
        {status === 'rejected' ? 'Request again' : 'Join club'}
      </Button>
    )
  }

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Student portal"
        title="Clubs & societies"
        description="Find a community on campus, meet new people, and keep up with the events your clubs host."
        actions={
          <Link to="/student/events" className={buttonStyles({ variant: 'secondary' })}>
            Browse events
          </Link>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value)
            setPage(1)
          }}
          placeholder="Search clubs by name…"
          className="w-full sm:max-w-sm"
        />
        <p className="text-xs text-ink-400">
          {clubs.data ? `${clubs.data.meta.total} approved ${clubs.data.meta.total === 1 ? 'club' : 'clubs'}` : 'Approved clubs only'}
        </p>
      </div>

      {clubs.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-64 rounded-3xl" />
          ))}
        </div>
      ) : clubs.isError ? (
        <ErrorState
          title="We could not load the clubs"
          message={errorMessage(clubs.error)}
          onRetry={() => clubs.refetch()}
        />
      ) : clubs.data && clubs.data.data.length > 0 ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {clubs.data.data.map((club) => (
              <ClubCard
                key={club.clubId}
                club={club}
                to={`/student/clubs/${club.clubId}`}
                actions={renderActions(club)}
              />
            ))}
          </div>
          <Pagination meta={clubs.data.meta} onPageChange={setPage} label="clubs" />
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={search ? <SearchX className="h-6 w-6" /> : <Users className="h-6 w-6" />}
            title={search ? 'No clubs match that search' : 'No clubs yet'}
            description={
              search
                ? 'Try a different name, or clear the search to see every approved club.'
                : 'Approved clubs will appear here as soon as they are published by the administration.'
            }
            action={
              search ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setSearch('')
                    setPage(1)
                  }}
                >
                  Clear search
                </Button>
              ) : (
                <Link to="/student/events" className={buttonStyles({ size: 'sm' })}>
                  Browse events
                </Link>
              )
            }
          />
        </Card>
      )}
    </div>
  )
}
