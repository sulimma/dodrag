import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TaskDescriptionEditor } from '../src/components/editor/TaskDescriptionEditor';
import '../src/index.css';

function Fixture() {
  const [description, setDescription] = useState(new URLSearchParams(location.search).get('description') ?? '```smiles\nCC(=O)O\n```');
  return <div style={{ display: 'flex', width: 'min(100vw, 720px)', height: '100vh' }}>
    <TaskDescriptionEditor taskId="fixture" description={description} onChange={setDescription}
      onContextMenu={() => {}} onError={error => { throw error; }} onEscape={() => {}} />
  </div>;
}

createRoot(document.getElementById('fixture')!).render(<Fixture />);
