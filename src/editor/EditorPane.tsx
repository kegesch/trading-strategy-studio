import { useRef } from 'react'
import Editor, { loader, type OnMount, type BeforeMount } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'

import { pineLanguage } from './pine-language'
import { detectLanguage } from './detect-language'
import { checkScript } from './diagnostics'

// Bundle monaco locally instead of the @monaco-editor/react CDN default.
loader.config({ monaco })

const beforeMount: BeforeMount = (monacoInstance) => {
  if (!monacoInstance.languages.getLanguages().some((l: { id: string }) => l.id === 'pine')) {
    monacoInstance.languages.register({ id: 'pine' })
    monacoInstance.languages.setMonarchTokensProvider('pine', pineLanguage)
  }
}

interface Props {
  value: string
  onChange: (value: string) => void
  onSave?: () => void
}

export default function EditorPane({ value, onChange, onSave }: Props) {
  const language = detectLanguage(value)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const onMount: OnMount = (editor, monacoInstance) => {
    editorRef.current = editor
    if (onSave) {
      editor.addCommand(
        monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS,
        () => onSave(),
      )
    }
    editor.focus()
  }

  const updateDiagnostics = (source: string) => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const editor = editorRef.current
      if (!editor) return
      const model = editor.getModel()
      if (!model || model.getValue() !== source) return
      monaco.editor.setModelMarkers(
        model,
        'pinets',
        checkScript(source).map((d) => ({
          startLineNumber: d.line,
          endLineNumber: d.line,
          startColumn: d.column,
          endColumn: d.column + 1,
          message: d.message,
          severity: monaco.MarkerSeverity.Error,
          source: 'pinets',
        })),
      )
    }, 500)
  }

  return (
    <div className="min-h-0 flex-1">
      <Editor
        height="100%"
        theme="vs-dark"
        language={language}
        value={value}
        beforeMount={beforeMount}
        onMount={onMount}
        onChange={(v) => {
          const source = v ?? ''
          onChange(source)
          updateDiagnostics(source)
        }}
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
    </div>
  )
}
