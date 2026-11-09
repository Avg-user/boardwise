import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { createTask, listTasks, tasksQueryKey, updateTask } from '../../api/tasks.ts'
import type { Task } from '../../api/types.ts'
import { useConversation } from './useConversation.ts'

/** The backend's limit for task titles. */
const MAX_STEP_LENGTH = 200

type NextStepsPanelProps = {
  caseId: number
  canEdit: boolean
}

function NextStepsPanel({ caseId, canEdit }: NextStepsPanelProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const queryKey = tasksQueryKey(caseId)
  const { messages } = useConversation(caseId)
  const [newStep, setNewStep] = useState('')
  // For the slide animation: each row's element, and where each row sat last time.
  const rowRefs = useRef(new Map<number, HTMLLIElement>())
  const lastTops = useRef(new Map<number, number>())

  // When the backend's order moves a step (finished steps go last), slide it from its old
  // place to the new one instead of jumping. Positions are measured within the list, so
  // scrolling the page doesn't count as movement.
  useLayoutEffect(() => {
    const reduceMotion = document.documentElement.dataset.motion === 'reduce'
    const tops = new Map<number, number>()
    rowRefs.current.forEach((row, id) => {
      const top = row.offsetTop
      tops.set(id, top)
      const previous = lastTops.current.get(id)
      if (!reduceMotion && previous !== undefined && previous !== top) {
        row.animate(
          [{ transform: `translateY(${previous - top}px)` }, { transform: 'translateY(0)' }],
          { duration: 480, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
        )
      }
    })
    lastTops.current = tops
  })
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

  function handleAddStep(event: FormEvent) {
    event.preventDefault()
    const title = newStep.trim()
    if (!title || addTask.isPending) return
    addTask.mutate(title, { onSuccess: () => setNewStep('') })
  }

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
              <li
                key={task.id}
                ref={(row) => {
                  if (row) rowRefs.current.set(task.id, row)
                  else rowRefs.current.delete(task.id)
                }}
              >
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
      {canEdit && tasks && (
        <form className="add-step" onSubmit={handleAddStep}>
          <label className="visually-hidden" htmlFor={`add-step-${caseId}`}>
            {t('case.addStepLabel')}
          </label>
          <input
            id={`add-step-${caseId}`}
            maxLength={MAX_STEP_LENGTH}
            autoComplete="off"
            placeholder={t('case.addStepPlaceholder')}
            value={newStep}
            onChange={(event) => setNewStep(event.target.value)}
          />
          <button
            type="submit"
            className="button-quiet"
            disabled={addTask.isPending || !newStep.trim()}
          >
            {t('case.addStep')}
          </button>
        </form>
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
