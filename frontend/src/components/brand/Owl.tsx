// Boardwise's mascot: a small owl ("board" + "wise") wearing a work ID lanyard, so it belongs to
// any workplace. Original artwork. Decorative everywhere it appears, so it's hidden from screen
// readers. Motion (blink, head tilt, wave) is CSS in index.css and respects reduced motion.
// With followPointer, the pupils look towards the mouse.
import { useEffect, useRef, type RefObject } from 'react'

/** How far the pupils can move inside the face discs, in SVG units. */
const PUPIL_REACH = 4.5

function usePupilsFollowPointer(svgRef: RefObject<SVGSVGElement | null>, enabled: boolean) {
  useEffect(() => {
    const svg = svgRef.current
    const pupils = svg?.querySelector<SVGGElement>('.owl__pupils')
    if (!enabled || !svg || !pupils) return
    let frame = 0
    let x = 0
    let y = 0

    function update() {
      frame = 0
      const box = svg!.getBoundingClientRect()
      // The eyes sit about a third of the way down the owl.
      const dx = x - (box.left + box.width / 2)
      const dy = y - (box.top + box.height * 0.33)
      const distance = Math.hypot(dx, dy) || 1
      const reach = Math.min(1, distance / 200) * PUPIL_REACH
      // Inside an SVG, CSS px in a transform are SVG units. style (not the attribute) lets CSS smooth it.
      pupils!.style.transform = `translate(${((dx / distance) * reach).toFixed(2)}px, ${((dy / distance) * reach).toFixed(2)}px)`
    }

    function onMove(event: PointerEvent) {
      x = event.clientX
      y = event.clientY
      if (!frame) frame = requestAnimationFrame(update)
    }

    function onLeave() {
      pupils!.style.transform = ''
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    document.documentElement.addEventListener('pointerleave', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('pointerleave', onLeave)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [svgRef, enabled])
}

function OwlHead({ withCovers = false }: { withCovers?: boolean }) {
  return (
    <g className="owl__head">
      {/* Ear tufts */}
      <path className="owl__body" d="M22 30 L27 6 L44 22 Z" />
      <path className="owl__body" d="M98 30 L93 6 L76 22 Z" />
      {/* Head */}
      <ellipse className="owl__body" cx="60" cy="48" rx="42" ry="34" />
      <path className="owl__brow" d="M30 30 Q44 22 58 32 M90 30 Q76 22 62 32" strokeWidth="3" />
      {/* Face discs */}
      <circle className="owl__face" cx="43" cy="50" r="17" />
      <circle className="owl__face" cx="77" cy="50" r="17" />
      {/* Eyes: the outer group blinks (CSS), the inner group follows the pointer (JS). */}
      <g className="owl__eyes">
        <g className="owl__pupils">
          <circle className="owl__eye" cx="43" cy="50" r="8.5" />
          <circle className="owl__eye" cx="77" cy="50" r="8.5" />
          <circle className="owl__glint" cx="46" cy="47" r="2.6" />
          <circle className="owl__glint" cx="80" cy="47" r="2.6" />
        </g>
      </g>
      {/* Beak */}
      <path className="owl__beak" d="M54.5 60 H65.5 L60 71 Z" />
      {/* Wings raised over the eyes. Hidden below until .owl--covering (CSS). */}
      {withCovers && (
        <g className="owl__covers">
          <path className="owl__wing" d="M22 62 Q22 32 44 32 Q62 34 60 54 Q52 70 36 70 Q24 70 22 62 Z" />
          <path className="owl__wing" d="M98 62 Q98 32 76 32 Q58 34 60 54 Q68 70 84 70 Q96 70 98 62 Z" />
          <path
            className="owl__feathers"
            d="M30 50 Q38 44 46 50 M34 59 Q42 53 50 59 M90 50 Q82 44 74 50 M86 59 Q78 53 70 59"
            strokeWidth="2"
          />
        </g>
      )}
    </g>
  )
}

type OwlProps = {
  className?: string
  /** Waves now and then. Use sparingly: the sign-in page only. */
  wave?: boolean
  /** The pupils look towards the mouse. */
  followPointer?: boolean
  /** Raises its wings over its eyes, e.g. while a password is being typed. */
  coverEyes?: boolean
}

export function Owl({
  className = '',
  wave = false,
  followPointer = false,
  coverEyes,
}: OwlProps) {
  const ref = useRef<SVGSVGElement>(null)
  usePupilsFollowPointer(ref, followPointer)
  return (
    <svg
      ref={ref}
      className={`owl ${wave ? 'owl--wave' : ''} ${coverEyes ? 'owl--covering' : ''} ${className}`}
      viewBox="0 0 120 152"
      aria-hidden="true"
      focusable="false"
    >
      {/* Feet */}
      <path className="owl__feet" d="M44 140 q4 -6 8 0 q4 -6 8 0 Z M60 140 q4 -6 8 0 q4 -6 8 0 Z" />
      {/* Body and belly */}
      <ellipse className="owl__body" cx="60" cy="98" rx="38" ry="44" />
      <ellipse className="owl__belly" cx="60" cy="106" rx="25" ry="31" />
      <path
        className="owl__scallops"
        d="M46 98 q3.5 4 7 0 q3.5 4 7 0 q3.5 4 7 0 q3.5 4 7 0 M42 110 q3.5 4 7 0 q3.5 4 7 0 q3.5 4 7 0 q3.5 4 7 0 q3.5 4 7 0 M46 122 q3.5 4 7 0 q3.5 4 7 0 q3.5 4 7 0 q3.5 4 7 0"
        strokeWidth="1.6"
      />
      {/* Wings */}
      <path className="owl__wing" d="M24 82 Q12 110 30 134 Q38 108 24 82 Z" />
      <g className="owl__wing-right">
        <path className="owl__wing" d="M96 82 Q108 110 90 134 Q82 108 96 82 Z" />
      </g>
      {/* Lanyard and ID badge */}
      <path className="owl__strap" d="M44 74 L56 106 M76 74 L64 106" strokeWidth="3.5" />
      <rect className="owl__badge" x="49" y="104" width="22" height="27" rx="3" />
      <rect className="owl__badge-top" x="49" y="104" width="22" height="7" rx="3" />
      <circle className="owl__badge-photo" cx="55" cy="119" r="3" />
      <path className="owl__badge-lines" d="M61 117 H67 M61 121 H66 M53 126 H67" strokeWidth="1.6" />
      <OwlHead withCovers={coverEyes !== undefined} />
    </svg>
  )
}

/** Just the head, for the logo and small labels. */
export function OwlMark({ className = '' }: { className?: string }) {
  return (
    <svg className={`owl owl-mark ${className}`} viewBox="14 2 92 84" aria-hidden="true" focusable="false">
      <OwlHead />
    </svg>
  )
}

export default Owl
