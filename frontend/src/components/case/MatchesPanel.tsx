import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { closeMatch, listCaseMatches } from '../../api/lawfirms.ts'

/** The case owner's requests to law firms, with a way to withdraw or stop sharing. */
function MatchesPanel({ caseId }: { caseId: number }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: ['cases', caseId, 'matches'],
    queryFn: () => listCaseMatches(caseId),
  })
  const close = useMutation({
    mutationFn: (matchId: number) => closeMatch(caseId, matchId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['cases', caseId, 'matches'] }),
  })
  const open = data?.filter((match) => match.status === 'pending' || match.status === 'accepted') ?? []

  return (
    <>
      <h2>{t('matches.title')}</h2>
      {open.length === 0 ? (
        <p className="placeholder-notice">{t('matches.none')}</p>
      ) : (
        <ul className="match-list">
          {open.map((match) => (
            <li key={match.id}>
              <span className="match-list__name">{match.firm_name}</span>
              <span className={`tag status--${match.status}`}>{t(`matches.status.${match.status}`)}</span>
              <button
                type="button"
                className="button-quiet"
                disabled={close.isPending}
                onClick={() => close.mutate(match.id)}
              >
                {match.status === 'accepted' ? t('matches.stopSharing') : t('matches.withdraw')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <Link to="/lawyers">{t('matches.find')}</Link>
    </>
  )
}

export default MatchesPanel
