// Decorative, original illustration of a street with different workplaces: an office, a clinic,
// a café and a warehouse, with a delivery van passing. All motion is CSS (see "Workplace scene"
// in index.css) and stops when the person has asked for reduced motion.

type PersonProps = {
  outfit: string
  skin: 'skin-1' | 'skin-2' | 'skin-3' | 'skin-4'
  hat?: 'chef' | 'cap'
  vest?: boolean
  walking?: boolean
}

/** A small standing figure, 16 wide and 44 tall, feet at y=44. */
function Person({ outfit, skin, hat, vest, walking }: PersonProps) {
  return (
    <g className={walking ? 'person person--walking' : 'person'}>
      <g className="person__legs">
        <path className="scene-ink" d="M8 30 L5 44" strokeWidth="3.5" strokeLinecap="round" />
        <path className="scene-ink leg-b" d="M8 30 L11 44" strokeWidth="3.5" strokeLinecap="round" />
      </g>
      <rect className={outfit} x="2" y="12" width="12" height="20" rx="3" />
      {vest && <path className="scene-reflect" d="M3 20 H13 M3 25 H13" strokeWidth="1.5" />}
      <circle className={`scene-${skin}`} cx="8" cy="7" r="5" />
      {hat === 'chef' && (
        <path className="scene-white" d="M3 4 Q2 -3 6 -2 Q8 -6 11 -2 Q15 -3 13 4 Z" />
      )}
      {hat === 'cap' && <path className="scene-accent-fill" d="M3 5 Q8 -1 13 5 H15 V6 H3 Z" />}
    </g>
  )
}

export function DeliveryVan({ className = '' }: { className?: string }) {
  return (
    <g className={`van ${className}`}>
      <path className="scene-van" d="M2 8 H70 V20 L88 22 L98 34 V46 H2 Z" />
      <path className="scene-glass" d="M72 12 H80 L92 32 H72 Z" />
      <rect className="scene-yellow" x="2" y="28" width="68" height="5" />
      <rect className="scene-beacon" x="58" y="3" width="7" height="5" rx="1.5" />
      {[22, 78].map((cx) => (
        <g key={cx} className="wheel">
          <circle className="scene-tire" cx={cx} cy="46" r="8" />
          <circle className="scene-hub" cx={cx} cy="46" r="3" />
          <path className="scene-dark" d={`M${cx - 5.5} 46 H${cx + 5.5}`} strokeWidth="1.5" />
        </g>
      ))}
    </g>
  )
}

function Forklift() {
  return (
    <g className="forklift">
      {/* Pallet with boxes, on the forks */}
      <g className="forklift__load">
        <rect className="scene-box" x="-34" y="10" width="14" height="13" />
        <rect className="scene-box" x="-19" y="10" width="14" height="13" />
        <rect className="scene-box" x="-27" y="-3" width="14" height="13" />
        <path className="scene-tape" d="M-34 16 H-20 M-19 16 H-5 M-27 3 H-13" strokeWidth="1.5" />
        <rect className="scene-pallet" x="-36" y="23" width="32" height="4" />
      </g>
      <path className="scene-steel" d="M-2 -10 V36 M-6 -10 V36" strokeWidth="2.5" />
      <path className="scene-steel" d="M-4 28 H-38" strokeWidth="2.5" />
      {/* Body and cage */}
      <path className="scene-yellow" d="M0 18 H34 L40 26 V38 H0 Z" />
      <path className="scene-steel" d="M4 18 V0 H26 L30 18" strokeWidth="2" fill="none" />
      <rect className="scene-steel-fill" x="30" y="8" width="10" height="10" />
      <g transform="translate(9 -6)">
        <circle className="scene-skin-4" cx="7" cy="7" r="4.5" />
        <path className="scene-vest" d="M2 12 H12 V24 H2 Z" />
      </g>
      {[10, 32].map((cx) => (
        <g key={cx} className="wheel">
          <circle className="scene-tire" cx={cx} cy="40" r="6" />
          <circle className="scene-hub" cx={cx} cy="40" r="2.5" />
        </g>
      ))}
    </g>
  )
}

const OFFICE_WINDOWS = Array.from({ length: 24 }, (_, i) => ({
  x: 34 + (i % 4) * 28,
  y: 92 + Math.floor(i / 4) * 26,
  // A few windows switch on and off, each on its own rhythm.
  flicker: [2, 7, 13, 18, 21].includes(i) ? i % 5 : null,
}))

function WorkplaceScene() {
  return (
    <svg className="workplace-scene" viewBox="0 0 720 340" aria-hidden="true" focusable="false">
      {/* Office tower */}
      <g>
        <rect className="scene-building" x="22" y="72" width="128" height="198" />
        <rect className="scene-building-dark" x="22" y="64" width="128" height="10" />
        <path className="scene-steel" d="M120 64 V40" strokeWidth="2" />
        <rect className="scene-beacon" x="117" y="36" width="6" height="6" rx="1" />
        {OFFICE_WINDOWS.map((w) => (
          <rect
            key={`${w.x}-${w.y}`}
            className={w.flicker === null ? 'scene-window' : `scene-window window--flicker window--d${w.flicker}`}
            x={w.x}
            y={w.y}
            width="20"
            height="16"
          />
        ))}
        <rect className="scene-glass" x="70" y="246" width="32" height="24" />
      </g>

      {/* Clinic */}
      <g>
        <rect className="scene-building-light" x="170" y="142" width="132" height="128" />
        <rect className="scene-green" x="214" y="152" width="44" height="44" rx="4" />
        <path className="scene-white-fill" d="M231 158 H241 V169 H252 V179 H241 V190 H231 V179 H220 V169 H231 Z" />
        <rect className="scene-glass" x="182" y="206" width="28" height="22" />
        <rect className="scene-glass" x="262" y="206" width="28" height="22" />
        <rect className="scene-glass" x="220" y="216" width="32" height="54" />
        <path className="scene-building-dark-line" d="M236 216 V270" strokeWidth="2" />
      </g>

      {/* Café */}
      <g>
        <rect className="scene-building-warm" x="322" y="168" width="122" height="102" />
        <path className="scene-awning" d="M316 196 H450 L444 214 H322 Z" />
        <path
          className="scene-awning-stripe"
          d="M332 196 L330 214 M352 196 L350 214 M372 196 L370 214 M392 196 L392 214 M412 196 L414 214 M432 196 L434 214"
          strokeWidth="8"
        />
        <rect className="scene-glass" x="332" y="222" width="62" height="36" />
        <g transform="translate(352 226)">
          <Person outfit="scene-white" skin="skin-2" hat="chef" />
        </g>
        {/* Counter and wall hide the chef below the waist */}
        <rect className="scene-building-warm" x="332" y="250" width="62" height="20" />
        <rect className="scene-door" x="404" y="222" width="28" height="48" />
        {/* Mug sign with rising steam */}
        <g transform="translate(366 174)">
          <path className="scene-white-fill" d="M0 6 H16 V16 Q16 20 12 20 H4 Q0 20 0 16 Z" />
          <path className="scene-white" d="M16 9 Q22 9 22 13 Q22 17 16 16" strokeWidth="2" fill="none" />
          <path className="steam steam--a" d="M5 3 Q2 0 5 -3" strokeWidth="1.5" />
          <path className="steam steam--b" d="M11 3 Q8 0 11 -3" strokeWidth="1.5" />
        </g>
      </g>

      {/* Warehouse */}
      <g>
        <path className="scene-building" d="M464 270 V136 L582 112 L700 136 V270 Z" />
        <rect className="scene-door-roll" x="496" y="184" width="96" height="86" />
        <path
          className="scene-building-dark-line"
          d="M496 194 H592 M496 204 H592 M496 214 H592 M496 224 H592 M496 234 H592"
          strokeWidth="1.5"
        />
        <rect className="scene-yellow" x="496" y="176" width="96" height="6" />
        <rect className="scene-glass" x="618" y="170" width="56" height="18" />
      </g>
      <g transform="translate(640 226)">
        <g className="forklift-move">
          <Forklift />
        </g>
      </g>

      {/* Sidewalk and road */}
      <rect className="scene-sidewalk" x="0" y="270" width="720" height="12" />
      <rect className="scene-road" x="0" y="282" width="720" height="58" />
      <path className="scene-road-line road-dashes" d="M0 312 H720" strokeWidth="3" />

      {/* Nurse walking past the clinic; office worker with a coffee */}
      <g transform="translate(180 213) scale(1.3)">
        <g className="walk-a">
          <Person outfit="scene-scrubs" skin="skin-3" walking />
        </g>
      </g>
      <g transform="translate(40 213) scale(1.3)">
        <g className="walk-b">
          <Person outfit="scene-blazer" skin="skin-1" walking />
        </g>
      </g>

      <g transform="translate(0 266)">
        <g className="van-drive">
          <DeliveryVan />
        </g>
      </g>
    </svg>
  )
}

/** A small parked van for empty states. */
export function MiniVan() {
  return (
    <svg className="mini-van" viewBox="-2 0 104 58" aria-hidden="true" focusable="false">
      <DeliveryVan className="van--idle" />
    </svg>
  )
}

/** Safety shield with a check mark, used as the logo mark. */
export function SafetyMark() {
  return (
    <svg className="safety-mark" viewBox="0 0 24 28" aria-hidden="true" focusable="false">
      <path d="M12 1 L23 5 V13 Q23 22 12 27 Q1 22 1 13 V5 Z" fill="currentColor" />
      <path
        d="M7 14 L11 18 L17 9"
        fill="none"
        stroke="var(--color-on-primary)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default WorkplaceScene
