type AgricultureSceneKind = 'greenhouse' | 'machinery'

function GreenhouseIllustration(): React.JSX.Element {
  return (
    <svg viewBox="0 0 360 224" fill="none" aria-hidden="true">
      <ellipse cx="179" cy="177" rx="146" ry="31" fill="#62dba4" opacity="0.035" />
      <path d="m30 149 140 62 165-80-140-61Z" fill="#0b2426" stroke="#315947" />
      <path d="m30 149 140 62v8L30 157Zm140 62 165-80v8l-165 80Z" fill="#0c191f" stroke="#25473e" />
      <g stroke="#4d8063" strokeWidth="0.8" opacity="0.55">
        <path d="m39 153 165-80m-148 88 165-80m-148 88 165-80m-148 88 165-80m-148 88 165-80m-148 88 165-80" />
      </g>
      <path d="m65 153 120 44 100-43-120-44Z" fill="#123c30" stroke="#57947c" />
      <g stroke="#69bc89" strokeWidth="1.3">
        {[0, 1, 2].map((row) => (
          <g key={row} transform={`translate(${row * 32} ${row * 12})`}>
            <path d="m79 146 86-37" stroke="#405e38" strokeWidth="6" />
            {[0, 1, 2, 3, 4].map((plant) => (
              <g key={plant} transform={`translate(${81 + plant * 17} ${140 - plant * 7.3})`}>
                <path d="M0 4V-9" />
                <path
                  d="M0 0q-10 0-9-9Q0-10 0 0Zm0-3q10-1 8-10Q-1-12 0-3Z"
                  fill="#68ae72"
                  strokeWidth="0.7"
                />
              </g>
            ))}
          </g>
        ))}
      </g>
      <path
        d="M65 153V98l60-30 60 74v55Z"
        fill="#6bd9be"
        fillOpacity="0.045"
        stroke="#81cdb6"
        strokeWidth="1.4"
      />
      <path
        d="m185 142 100-43v55l-100 43Z"
        fill="#4ecbb6"
        fillOpacity="0.09"
        stroke="#76bea9"
        strokeWidth="1.2"
      />
      <path
        d="m65 98 60-30 100-43-60 30Z"
        fill="#80ccb0"
        fillOpacity="0.13"
        stroke="#81cdb6"
        strokeWidth="1.3"
      />
      <path d="m125 68 60 74 100-43-60-74Z" fill="#103643" stroke="#a1dcc3" strokeWidth="1.5" />
      <g stroke="#76b1ae" strokeWidth="0.8">
        {[1, 2, 3, 4].map((column) => (
          <path key={column} d={`M${125 + column * 20} ${68 - column * 8.6}l60 74`} />
        ))}
        {[1, 2, 3].map((row) => (
          <path key={row} d={`M${125 + row * 15} ${68 + row * 18.5}l100-43`} />
        ))}
      </g>
      <g stroke="#70bba2" strokeWidth="0.9" opacity="0.7">
        <path d="m89 86 100-43m-76 31 100-43M88 108v54m34-42v54m34-42v54m54-55v55m25-66v55m25-66v55M65 125l120 44 100-43" />
      </g>
      <path d="m109 169 1-45 24 9v45" fill="#92cbae" fillOpacity="0.055" stroke="#92cbae" />
      <path d="m133 165 0-7" stroke="#ddedbf" strokeWidth="2" />
      <g stroke="#e2c47b" strokeWidth="1.3">
        <circle cx="56" cy="45" r="13" fill="#dec97c" fillOpacity="0.07" />
        <path d="M56 22v5m0 36v5M33 45h5m36 0h5M40 29l4 4m25 25 4 4m0-33-4 4M44 58l-4 4" />
        <path d="m83 49 34 13m-27-1 15 6" strokeOpacity="0.4" strokeDasharray="3 5" />
      </g>
      <g fill="#8fe7b5">
        <circle cx="65" cy="153" r="2" />
        <circle cx="185" cy="197" r="2" />
        <circle cx="285" cy="154" r="2" />
      </g>
    </svg>
  )
}

function MachineryIllustration(): React.JSX.Element {
  return (
    <svg viewBox="0 0 360 224" fill="none" aria-hidden="true">
      <ellipse cx="178" cy="175" rx="145" ry="32" fill="#d8c582" opacity="0.035" />
      <path d="m26 164 140 48 167-70-142-47Z" fill="#172725" stroke="#4a5945" />
      <path d="m26 164 140 48v7L26 171Zm140 48 167-70v7l-167 70Z" fill="#0d1d20" stroke="#354b3d" />
      <g stroke="#5b7050" opacity="0.4">
        <path d="m43 166 129 43m-83-58 130 43m-84-60 130 43m-85-59 130 43" />
      </g>
      <g stroke="#86af89" strokeWidth="1.2">
        <path d="m252 147 35 12 23-11-35-12Z" fill="#153e35" />
        <path d="M257 147V75l27 9v72Zm27 9V84l21-10v72Z" fill="#183c38" />
        <path d="m257 75 21-10 27 9-21 10Z" fill="#356653" />
        <path d="m263 86 15 5v25l-15-5Z" fill="#081e24" stroke="#69aa90" />
        <path d="m271 91-5 10 6 2-3 8 7-11-6-2Z" fill="#d6d793" stroke="none" />
        <path d="m265 127 11 4m-11 4 11 4" stroke="#7ab990" />
        <path
          d="M303 91c22 5 15 42 10 56-8 24-29 21-56 4l-23-15"
          stroke="#a4c398"
          strokeWidth="2.5"
        />
        <path d="m231 132 8 4-4 8-8-4Z" fill="#96be91" />
      </g>
      <g stroke="#5b7c76" strokeWidth="1.2">
        <ellipse cx="106" cy="136" rx="22" ry="27" fill="#0b1c21" />
        <ellipse cx="201" cy="127" rx="30" ry="38" fill="#0b1c21" />
        <path d="m61 141 123 37 45-32-119-36Z" fill="#12322f" />
      </g>
      <path d="m80 105 54-23 42 14-52 25Z" fill="#719d72" stroke="#a8c99a" strokeWidth="1.2" />
      <path d="m80 105 44 16v35l-44-15Z" fill="#38594a" stroke="#9bbc8c" />
      <path d="m124 121 52-25v34l-52 26Z" fill="#547e5b" stroke="#8eb184" />
      <g stroke="#152e2e" strokeWidth="2">
        <path d="m86 114 0 19m7-17v19m7-16v19m7-16v19" />
      </g>
      <path d="m83 108 10 3v5l-10-3Z" fill="#f3dba5" />
      <path
        d="M135 94V61l39-18 37 12v66l-40 23-36-12Z"
        fill="#75c3ba"
        fillOpacity="0.12"
        stroke="#91bda5"
        strokeWidth="1.4"
      />
      <path
        d="m142 64 27 9v51l-27-9Zm34 9 27-13v52l-27 16Z"
        fill="#29616a"
        fillOpacity="0.4"
        stroke="#6eaba1"
      />
      <path d="m130 60 44-22 44 14-45 23Z" fill="#92b38a" stroke="#b6d5a7" strokeWidth="1.2" />
      <path d="m130 60 43 15v5l-43-15Zm43 15 45-23v5l-45 23Z" fill="#3e6654" stroke="#82a883" />
      <path d="m176 106 17-9 7 7m-15-1v17" stroke="#90bfa9" strokeWidth="2" />
      <path d="M117 100V78l5-3v24" fill="#193832" stroke="#809d85" />
      <path
        d="m152 134 32-8 41 14v10l-43-11-28 9Z"
        fill="#8aac7c"
        stroke="#b4cf93"
        strokeWidth="1.3"
      />
      <g stroke="#789886">
        <ellipse cx="99" cy="155" rx="23" ry="28" fill="#0a181d" strokeWidth="3" />
        <ellipse cx="99" cy="155" rx="13" ry="17" fill="#33554b" />
        <ellipse cx="99" cy="155" rx="5" ry="7" fill="#abc6a3" />
        <ellipse cx="188" cy="164" rx="33" ry="40" fill="#0a181d" strokeWidth="3" />
        <ellipse cx="188" cy="164" rx="21" ry="27" fill="#3b5f50" />
        <ellipse cx="188" cy="164" rx="8" ry="11" fill="#b9cfa1" />
      </g>
      <g stroke="#6d8b7a" strokeWidth="3" strokeLinecap="round">
        <path d="m169 134 6 4m-15 10 7 2m-10 13h8m-5 15 7-2m2 14 6-4m20-56-2 7m18 7-5 4m11 11-7 2m6 14-7-1m0 16-5-4" />
      </g>
      <path d="m232 86 12-5m-9 15 11-2" stroke="#d7cf8f" strokeDasharray="3 3" />
    </svg>
  )
}

export default function AgricultureScene({
  kind
}: {
  kind: AgricultureSceneKind
}): React.JSX.Element {
  const greenhouse = kind === 'greenhouse'
  return (
    <figure className={`agriculture-scene agriculture-scene--${kind}`}>
      <figcaption>
        <h3>{greenhouse ? '农业大棚' : '农业机械'}</h3>
        <p>{greenhouse ? 'GREENHOUSE ENERGY' : 'AGRICULTURAL MACHINERY'}</p>
      </figcaption>
      <div className="agriculture-scene-art">
        {greenhouse ? <GreenhouseIllustration /> : <MachineryIllustration />}
      </div>
    </figure>
  )
}
