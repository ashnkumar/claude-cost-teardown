import type { ReactNode } from 'react'

/**
 * A small markdown renderer.
 *
 * Deliberately not a dependency: reports use headings, lists, tables, code and
 * links and nothing else, and this way every element carries the exact classes
 * the rest of the UI uses.
 */

const INLINE = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g

function renderInline(text: string): ReactNode[] {
  return text.split(INLINE).filter(Boolean).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      )
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={i}
          className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground"
        >
          {part.slice(1, -1)}
        </code>
      )
    }
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)
    if (link) {
      return (
        <a
          key={i}
          href={link[2]}
          target="_blank"
          rel="noreferrer"
          className="text-agent underline underline-offset-2 hover:opacity-80"
        >
          {link[1]}
        </a>
      )
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return (
        <em key={i} className="italic">
          {part.slice(1, -1)}
        </em>
      )
    }
    return <span key={i}>{part}</span>
  })
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim())
}

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []

  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) {
      i += 1
      continue
    }

    // Horizontal rule
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push(<hr key={key++} className="my-6 border-border" />)
      i += 1
      continue
    }

    // Headings
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      const depth = heading[1].length
      const content = renderInline(heading[2])
      const cls =
        depth === 1
          ? 'mt-7 mb-3 text-xl font-semibold tracking-tight text-foreground first:mt-0'
          : depth === 2
            ? 'mt-6 mb-2.5 text-base font-semibold tracking-tight text-foreground first:mt-0'
            : 'mt-5 mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground first:mt-0'
      blocks.push(
        <p key={key++} className={cls}>
          {content}
        </p>,
      )
      i += 1
      continue
    }

    // Fenced code
    if (line.trim().startsWith('```')) {
      const body: string[] = []
      i += 1
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        body.push(lines[i])
        i += 1
      }
      i += 1
      blocks.push(
        <pre
          key={key++}
          className="my-4 overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs leading-relaxed"
        >
          {body.join('\n')}
        </pre>,
      )
      continue
    }

    // Table
    if (line.trim().startsWith('|') && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1] ?? '')) {
      const header = splitRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitRow(lines[i]))
        i += 1
      }
      blocks.push(
        <div key={key++} className="my-4 overflow-x-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-left text-[13px]">
            <thead>
              <tr className="bg-muted/50">
                {header.map((cell, c) => (
                  <th
                    key={c}
                    className="border-b border-border px-3 py-2 font-medium text-foreground"
                  >
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r} className="border-b border-border/60 last:border-0">
                  {row.map((cell, c) => (
                    <td key={c} className="px-3 py-2 align-top text-muted-foreground">
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    // Blockquote
    if (line.trim().startsWith('> ')) {
      const body: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('> ')) {
        body.push(lines[i].trim().slice(2))
        i += 1
      }
      blocks.push(
        <blockquote
          key={key++}
          className="my-4 border-l-2 border-agent/50 py-0.5 pl-4 text-muted-foreground"
        >
          {renderInline(body.join(' '))}
        </blockquote>,
      )
      continue
    }

    // Lists
    const bullet = /^\s*[-*+]\s+/
    const ordered = /^\s*\d+[.)]\s+/
    if (bullet.test(line) || ordered.test(line)) {
      const isOrdered = ordered.test(line)
      const items: string[] = []
      while (i < lines.length && (bullet.test(lines[i]) || ordered.test(lines[i]))) {
        items.push(lines[i].replace(bullet, '').replace(ordered, ''))
        i += 1
      }
      const ListTag = isOrdered ? 'ol' : 'ul'
      blocks.push(
        <ListTag
          key={key++}
          className={`my-3 space-y-1.5 pl-5 ${isOrdered ? 'list-decimal' : 'list-disc'} marker:text-muted-foreground/60`}
        >
          {items.map((item, n) => (
            <li key={n} className="pl-1 text-muted-foreground">
              {renderInline(item)}
            </li>
          ))}
        </ListTag>,
      )
      continue
    }

    // Paragraph
    const para: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4})\s/.test(lines[i]) &&
      !bullet.test(lines[i]) &&
      !ordered.test(lines[i]) &&
      !lines[i].trim().startsWith('|') &&
      !lines[i].trim().startsWith('>') &&
      !lines[i].trim().startsWith('```')
    ) {
      para.push(lines[i].trim())
      i += 1
    }
    blocks.push(
      <p key={key++} className="my-3 leading-relaxed text-muted-foreground">
        {renderInline(para.join(' '))}
      </p>,
    )
  }

  return <div className="text-[14px]">{blocks}</div>
}
