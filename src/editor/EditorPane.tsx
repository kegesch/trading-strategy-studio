import Editor, { loader, type OnMount, type BeforeMount } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'

import { pineLanguage } from './pine-language'

// Bundle monaco locally instead of the @monaco-editor/react CDN default.
loader.config({ monaco })

/** Detect PineScript via its `//@version=` pragma; anything else is TS. */
export function detectLanguage(source: string): 'pine' | 'typescript' {
  return /\/\/\s*@version\s*=/.test(source) ? 'pine' : 'typescript'
}

const beforeMount: BeforeMount = (monacoInstance) => {
  if (!monacoInstance.languages.getLanguages().some((l: { id: string }) => l.id === 'pine')) {
    monacoInstance.languages.register({ id: 'pine' })
    monacoInstance.languages.setMonarchTokensProvider('pine', pineLanguage)
  }
}

interface Props {
  value: string
  onChange: (value: string) => void
}

export default function EditorPane({ value, onChange }: Props) {
  const language = detectLanguage(value)

  const onMount: OnMount = (editor) => {
    editor.focus()
  }

  return (
    <Editor
      height="100%"
      theme="vs-dark"
      language={language}
      value={value}
      beforeMount={beforeMount}
      onMount={onMount}
      onChange={(v) => onChange(v ?? '')}
      options={{
        minimap: { enabled: false },
        fontSize: 12,
        tabSize: 4,
        scrollBeyondLastLine: false,
        automaticLayout: true,
        renderWhitespace: 'none',
        padding: { top: 8 },
      }}
      loading={<div className="p-3 text-xs text-slate-500">Loading editor…</div>}
    />
  )
}
