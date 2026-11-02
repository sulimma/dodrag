import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppToolbar } from '../src/components/AppToolbar';
import { useSearchHighlight } from '../src/hooks/useSearchHighlight';
import '../src/index.css';
function Fixture() {
  const [query, setQuery] = useState(''), [filter, setFilter] = useState(false);
  useSearchHighlight(query);
  return <>
    <AppToolbar viewMode="list" setViewMode={() => {}} nextTaskId="26-103" openTaskCount={2} openTaskDelta={0}
      canUndo={false} canRedo={false} snapshotReady newTaskTitle={query} setNewTaskTitle={setQuery}
      newTaskInputRef={React.createRef()} filterEnabled={filter} onToggleFilter={() => setFilter(value => !value)}
      onCreateTask={event => event.preventDefault()} onSubmit={event => event.preventDefault()}
      onUndo={() => {}} onRedo={() => {}} onSettings={() => {}} onHelp={() => {}} />
    <main style={{ padding: 30 }}>
      <p id="title" contentEditable suppressContentEditableWarning>Alpha <b>beta</b> 26-101</p>
      <div id="description" contentEditable suppressContentEditableWarning><p>Alpha</p><p>beta</p></div>
      <a id="link" href="#clicked">https://example.com/Alpha beta</a>
      <svg width="200" height="40"><text x="10" y="25">26-101</text></svg>
      <textarea aria-label="note" defaultValue={'Alpha\nbeta\nAlpha beta\nMore text\nAlpha beta'}
        style={{ width: 300, height: 70, padding: 8, border: '1px solid black', display: 'block', lineHeight: '20px', fontSize: 16 }} />
    </main>
  </>;
}
createRoot(document.getElementById('fixture')!).render(<Fixture />);
