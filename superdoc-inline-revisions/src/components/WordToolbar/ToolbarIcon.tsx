import type { ReactNode } from 'react';

export type IconName = 'grow' | 'shrink' | 'case' | 'clear' | 'bold' | 'italic' | 'underline' | 'strike' | 'subscript' | 'superscript' | 'highlight' | 'color' | 'bullets' | 'numbers' | 'multilevel' | 'outdent' | 'indent' | 'marks' | 'left' | 'center' | 'right' | 'justify' | 'spacing' | 'table';

export function ToolbarIcon({ name }: { name: IconName }) {
  const blue = '#3188b7';
  const text = (value: string, props = {}) => <text x="12" y="18" textAnchor="middle" fill="currentColor" stroke="none" fontSize="19" fontFamily="Calibri, Arial, sans-serif" {...props}>{value}</text>;
  let content: ReactNode;
  switch (name) {
    case 'grow': case 'shrink': content = <>{text('A', { x: 10, fontSize: name === 'grow' ? 20 : 16 })}<path stroke={blue} d={name === 'grow' ? 'm17 6 3-3 3 3' : 'm17 3 3 3 3-3'} /></>; break;
    case 'case': content = text('Aa', { fontSize: 17 }); break;
    case 'clear': content = <>{text('A', { x: 9 })}<path fill="#c571bd" stroke="#a1549b" d="m15 10 6 5-5 6-6-5z" /><path stroke="#fff" d="m13 16 4 3" /></>; break;
    case 'bold': content = text('B', { fontWeight: 700, fontSize: 17 }); break;
    case 'italic': content = text('I', { fontStyle: 'italic', fontFamily: 'Georgia, serif', fontSize: 17 }); break;
    case 'underline': content = <>{text('U', { y: 16, fontSize: 17 })}<path d="M6 20h12" /></>; break;
    case 'strike': content = <>{text('ab', { x: 13, y: 13, dominantBaseline: 'central', fontSize: 14 })}<path d="M3 14.5h20" /></>; break;
    case 'subscript': case 'superscript': content = <>{text('x', { x: 9, fontSize: 18 })}{text('2', { x: 18, y: name === 'subscript' ? 22 : 9, fontSize: 11, fill: blue })}</>; break;
    case 'highlight': content = <><path fill="#737b7e" d="m9 13 9-10 4 4-10 9-5 1z" /><path d="m8 14 3 3-4 3H4z" /><path stroke="#fff200" strokeWidth="4" d="M2 22h20" /></>; break;
    case 'color': content = <>{text('A', { y: 17 })}<path stroke="#e50022" strokeWidth="4" d="M2 22h20" /></>; break;
    case 'bullets': case 'numbers': case 'multilevel': content = <>{[5, 12, 19].map((y, i) => <g key={y}>{name === 'bullets' ? <rect x="2" y={y - 1} width="2" height="2" fill={blue} stroke={blue} /> : <text x={name === 'multilevel' ? 1 + i * 3 : 1} y={y + 2} fill={blue} stroke="none" fontSize="7">{name === 'multilevel' ? ['1.', 'a.', 'i.'][i] : `${i + 1}.`}</text>}<path d={`M${name === 'multilevel' ? 8 + i * 3 : 8} ${y}H22`} /></g>)}</>; break;
    case 'outdent': case 'indent': content = <><path d="M3 4h19M10 9h12M10 14h12M3 19h19" /><path stroke={blue} d={name === 'indent' ? 'M1 11h6M4 8l3 3-3 3' : 'M7 11H1M4 8l-3 3 3 3'} /></>; break;
    case 'marks': content = text('¶', { fontSize: 22, fontFamily: 'Georgia, serif', fontWeight: 700 }); break;
    case 'left': case 'center': case 'right': case 'justify': content = <>{[4, 9, 14, 19].map((y, i) => { const short = i % 2 === 1 && name !== 'justify'; const x = !short || name === 'left' ? 3 : name === 'center' ? 6 : 9; return <path key={y} d={`M${x} ${y}h${short ? 12 : 18}`} />; })}</>; break;
    case 'spacing': content = <><path stroke={blue} d="M5 2v20M2 5l3-3 3 3M2 19l3 3 3-3" /><path d="M12 5h10M12 12h10M12 19h10" /></>; break;
    case 'table': content = <><rect x="3" y="4" width="20" height="18" rx="1" /><path fill="#dbeaf4" stroke="none" d="M4 5h18v5H4z" /><path d="M3 10h20M3 16h20M10 4v18M17 4v18" /></>; break;
  }
  return <svg className={`word-icon word-icon-${name}`} viewBox="0 0 26 26" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{content}</svg>;
}
