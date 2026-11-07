import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { createTask, listTasks, updateTask } from '../../api/tasks.ts'
import type { Task } from '../../api/types.ts'
import { useConversation } from './useConversation.ts'

type NextStepsPanelProps = {
  caseId: number
  canEdit: boolean
}

function NextStepsPanel({ caseId, canEdit }: NextStepsPanelProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const queryKey = ['cases', caseId, 'tasks']
  const { messages } = useConversation(caseId)
  const { data: tasks, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () => listTasks(caseId),
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey })
  const toggleTask = useMutation({
    mutationFn: ({ id, done }: { id: number; done: boolean }) => updateTask(caseId, id, { done }),
    // Tick straight away, then put it back if the save fails.
    onMutate: async ({ id, done }) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<Task[]>(queryKey)
      queryClient.setQueryData<Task[]>(queryKey, (current) =>
        current?.map((task) => (task.id === id ? { ...task, done } : task)),
      )
      return { previous }
    },
    onError: (_error, _variables, context) => {
      queryClient.setQueryData(queryKey, context?.previous)
    },
    onSettled: refresh,
  })
  const addTask = useMutation({
    mutationFn: (title: string) => createTask(caseId, { title }),
    onSuccess: refresh,
  })

  const existingTitles = new Set(tasks?.map((task) => task.title))
  const suggestions = [
    ...new Set(
      messages.flatMap((message) => message.suggested_steps.map((step) => step.title)),
    ),
  ].filter((title) => !existingTitles.has(title))
  const doneCount = tasks?.filter((task) => task.done).length ?? 0

  return (
    <>
      <h2>{t('case.nextSteps')}</h2>
      {isLoading && <p role="status">{t('common.loading')}</p>}
      {(isError || toggleTask.isError || addTask.isError) && (
        <p className="form-error" role="alert">
          {t('common.serverError')}
        </p>
      )}
      {tasks?.length === 0 && <p className="placeholder-notice">{t('case.nextStepsEmpty')}</p>}
      {tasks && tasks.length > 0 && (
        <>
          <ul className="checklist">
            {tasks.map((task) => (
              <li key={task.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={task.done}
                    disabled={!canEdit}
                    onChange={(event) =>
                      toggleTask.mutate({ id: task.id, done: event.target.checked })
                    }
                  />
                  <span>{task.title}</span>
                </label>
              </li>
            ))}
          </ul>
          <p className="progress" role="status">
            {t('case.progress', { done: doneCount, total: tasks.length })}
          </p>
        </>
      )}
      {canEdit && tasks && suggestions.length > 0 && (
        <div className="suggestions">
          <h3>{t('case.suggestions')}</h3>
          <ul>
            {suggestions.map((title) => (
              <li key={title}>
                <span>{title}</span>
                <button
                  type="button"
                  className="button-quiet"
                  disabled={addTask.isPending}
                  aria-label={t('case.addStepNamed', { title })}
                  onClick={() => addTask.mutate(title)}
                >
                  {t('case.addStep')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

export default NextStepsPanel
