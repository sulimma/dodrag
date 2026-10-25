// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { TaskTitle } from './TaskTitle';
import { InlineEditor } from './inlineEditor';
import { SettingsModal, formatBuildTime } from './SettingsModal';
import { TaskState } from '../domain/types';
import { AppSettings } from '../bridge/eventBridge';
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);

it('renders a focused inline editor with Enter and Escape in the shared title component', () => {
  const element=document.createElement('div');document.body.append(element);const root=createRoot(element);
  const editor:InlineEditor={taskId:'t1',value:'Unsaved draft',onChange:vi.fn(),onStart:vi.fn(),onCommit:vi.fn(),onCancel:vi.fn()};
  act(()=>root.render(<TaskTitle task={{id:'t1',title:'Original'} as TaskState} editor={editor}/>));
  const input=element.querySelector('input')!;expect(document.activeElement).toBe(input);expect(input.value).toBe('Unsaved draft');
  act(()=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));expect(editor.onCommit).toHaveBeenCalledTimes(1);
  act(()=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));expect(editor.onCancel).toHaveBeenCalledTimes(1);
  act(()=>root.unmount());element.remove();
});

it('defaults demo checkbox from existing files and follows database creation until the user overrides it', () => {
  const element=document.createElement('div');const root=createRoot(element);
  const settings:AppSettings={knownDatabases:[{name:'missing',path:'missing.db',isDemo:true,exists:false}],activeDatabasePath:'',autostart:false};
  const props={onClose:vi.fn(),onSelectFolder:async()=>'',onCreateDatabase:async()=>{},onOpenExistingDatabase:async()=>{},onSwitchDatabase:async()=>{},onDeleteDatabase:async()=>{},onToggleAutostart:async()=>{}};
  act(()=>root.render(<SettingsModal settings={settings} {...props}/>));
  const checkbox=()=>element.querySelector<HTMLInputElement>('input[type=checkbox]')!;
  expect(checkbox().checked).toBe(true);
  // Creating the demo database while the dialog is open must clear the default.
  act(()=>root.render(<SettingsModal settings={{...settings,knownDatabases:[{...settings.knownDatabases[0],exists:true}]}} {...props}/>));
  expect(checkbox().checked).toBe(false);
  // An explicit choice survives later settings refreshes.
  act(()=>checkbox().click());
  expect(checkbox().checked).toBe(true);
  act(()=>root.render(<SettingsModal settings={{...settings,knownDatabases:[{...settings.knownDatabases[0],exists:true}]}} {...props}/>));
  expect(checkbox().checked).toBe(true);
  act(()=>root.unmount());const next=createRoot(element);
  act(()=>next.render(<SettingsModal settings={{...settings,knownDatabases:[{...settings.knownDatabases[0],exists:true}]}} {...props}/>));
  expect(checkbox().checked).toBe(false);
  act(()=>next.unmount());
});

it('shows only setup actions that are still needed', () => {
  const element=document.createElement('div');const root=createRoot(element);
  const settings:AppSettings={knownDatabases:[],activeDatabasePath:'',autostart:false,setup:{currentExe:'C:\\dodrag.exe',currentDir:'C:\\',installPath:'C:\\Users\\me\\AppData\\Local\\Programs\\DoDrag\\DoDrag.exe',programInstalled:false,desktopShortcut:false,startMenuShortcut:false}};
  const props={onClose:vi.fn(),onSelectFolder:async()=>'',onCreateDatabase:async()=>{},onOpenExistingDatabase:async()=>{},onSwitchDatabase:async()=>{},onDeleteDatabase:async()=>{},onToggleAutostart:async()=>{},onRunSetupAction:async()=>{}};
  const labels=()=>Array.from(element.querySelectorAll('button')).map(button=>button.textContent?.trim());
  act(()=>root.render(<SettingsModal settings={settings} {...props}/>));
  expect(element.textContent).toContain('C:\\');
  expect(labels()).toContain('Programm in den Benutzerordner installieren');
  expect(labels()).toContain('Desktop-Verknüpfung anlegen');
  expect(labels()).toContain('Startmenü-Verknüpfung anlegen');
  act(()=>root.render(<SettingsModal settings={{...settings,setup:{...settings.setup!,programInstalled:true,desktopShortcut:true,startMenuShortcut:true}}} {...props}/>));
  expect(labels()).not.toContain('Programm in den Benutzerordner installieren');
  expect(labels()).not.toContain('Desktop-Verknüpfung anlegen');
  expect(labels()).not.toContain('Startmenü-Verknüpfung anlegen');
  act(()=>root.unmount());element.remove();
});

it('uses native path menus for database and install folders and handles cancellation, errors and stale responses', async () => {
  const element=document.createElement('div');document.body.append(element);const root=createRoot(element);
  const settings:AppSettings={knownDatabases:[{name:'Aufgaben',path:'C:\\data\\tasks.db',isDemo:false,exists:true}],activeDatabasePath:'C:\\data\\tasks.db',autostart:false,databaseReady:true,setup:{currentExe:'C:\\Apps\\DoDrag\\DoDrag.exe',currentDir:'C:\\Apps\\DoDrag',installPath:'C:\\Apps\\DoDrag\\DoDrag.exe',programInstalled:true,desktopShortcut:true,startMenuShortcut:true}};
  const explorer=vi.fn(async()=>{});
  const props={onClose:vi.fn(),onSelectFolder:async()=>'',onCreateDatabase:async()=>{},onOpenExistingDatabase:async()=>{},onSwitchDatabase:vi.fn(async()=>{}),onDeleteDatabase:async()=>{},onToggleAutostart:async()=>{},onOpenFolderInExplorer:explorer,onOpenFolderInVSCode:vi.fn(async()=>{})};
  const showMenu=vi.fn(async()=> '');
  vi.stubGlobal('go',{main:{App:{ShowTaskContextMenu:showMenu}}});
  let unmounted=false;
  try {
    act(()=>root.render(<SettingsModal settings={settings} {...props}/>));
    const findDiv=(text:string)=>Array.from(element.querySelectorAll('div')).find(node=>node.textContent===text) as HTMLElement;
    const openMenu=async(path:string)=>{
      const event=new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:20,clientY:20});
      await act(async()=>{ findDiv(path).dispatchEvent(event); });
      expect(event.defaultPrevented).toBe(true);
    };
    expect(findDiv('C:\\data\\tasks.db').className).toContain('cursor-text');
    expect(findDiv('C:\\Apps\\DoDrag').className).toContain('cursor-text');

    showMenu.mockResolvedValueOnce('explorer');
    await openMenu('C:\\data\\tasks.db');
    expect(showMenu).toHaveBeenLastCalledWith([
      {id:'explorer',label:'Im Explorer öffnen',disabled:false},
      {id:'vscode',label:'In VS Code öffnen',disabled:false},
    ]);
    expect(element.textContent).not.toContain('Im Explorer öffnen');
    expect(explorer).toHaveBeenLastCalledWith('C:\\data\\tasks.db',true);
    expect(props.onSwitchDatabase).not.toHaveBeenCalled();

    showMenu.mockResolvedValueOnce('explorer');
    await openMenu('C:\\Apps\\DoDrag');
    expect(explorer).toHaveBeenLastCalledWith('C:\\Apps\\DoDrag',false);
    showMenu.mockResolvedValueOnce('vscode');
    await openMenu('C:\\data\\tasks.db');
    expect(props.onOpenFolderInVSCode).toHaveBeenLastCalledWith('C:\\data\\tasks.db',true);
    showMenu.mockResolvedValueOnce('vscode');
    await openMenu('C:\\Apps\\DoDrag');
    expect(props.onOpenFolderInVSCode).toHaveBeenLastCalledWith('C:\\Apps\\DoDrag',false);

    await openMenu('C:\\Apps\\DoDrag');
    showMenu.mockResolvedValueOnce('unknown');
    await openMenu('C:\\Apps\\DoDrag');
    expect(explorer).toHaveBeenCalledTimes(2);
    expect(props.onOpenFolderInVSCode).toHaveBeenCalledTimes(2);
    expect(element.textContent).not.toContain('Kontextmenü konnte nicht geöffnet werden');
    expect(element.textContent).not.toContain('Ordner konnte nicht geöffnet werden.');

    act(()=>root.render(<SettingsModal settings={settings} {...props} onOpenFolderInVSCode={undefined}/>));
    showMenu.mockResolvedValueOnce('vscode');
    await openMenu('C:\\Apps\\DoDrag');
    expect(showMenu).toHaveBeenLastCalledWith([
      {id:'explorer',label:'Im Explorer öffnen',disabled:false},
      {id:'vscode',label:'In VS Code öffnen',disabled:true},
    ]);
    expect(props.onOpenFolderInVSCode).toHaveBeenCalledTimes(2);
    act(()=>root.render(<SettingsModal settings={settings} {...props}/>));

    let finishOldMenu!:(id:string)=>void;
    showMenu.mockImplementationOnce(()=>new Promise(resolve=>{finishOldMenu=resolve;}));
    await openMenu('C:\\data\\tasks.db');
    showMenu.mockResolvedValueOnce('explorer');
    await openMenu('C:\\Apps\\DoDrag');
    await act(async()=>{finishOldMenu('vscode');});
    expect(explorer).toHaveBeenCalledTimes(3);
    expect(props.onOpenFolderInVSCode).toHaveBeenCalledTimes(2);

    let rejectOldMenu!:(error:Error)=>void;
    showMenu.mockImplementationOnce(()=>new Promise((_,reject)=>{rejectOldMenu=reject;}));
    await openMenu('C:\\data\\tasks.db');
    await openMenu('C:\\Apps\\DoDrag');
    await act(async()=>{rejectOldMenu(new Error('stale failure'));});
    expect(element.textContent).not.toContain('stale failure');

    showMenu.mockRejectedValueOnce(new Error('native failure'));
    await openMenu('C:\\Apps\\DoDrag');
    expect(element.textContent).toContain('Kontextmenü konnte nicht geöffnet werden');
    expect(element.textContent).toContain('native failure');
    explorer.mockRejectedValueOnce(new Error('path failure'));
    showMenu.mockResolvedValueOnce('explorer');
    await openMenu('C:\\Apps\\DoDrag');
    expect(element.textContent).toContain('Ordner konnte nicht geöffnet werden.');
    expect(element.textContent).toContain('path failure');

    showMenu.mockImplementationOnce(()=>new Promise(resolve=>{finishOldMenu=resolve;}));
    await openMenu('C:\\data\\tasks.db');
    act(()=>root.unmount());unmounted=true;
    await act(async()=>{finishOldMenu('vscode');});
    expect(props.onOpenFolderInVSCode).toHaveBeenCalledTimes(2);
  } finally {
    if (!unmounted) act(()=>root.unmount());
    element.remove();
    vi.unstubAllGlobals();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  }
});

it('formats an RFC3339 build timestamp for local display and preserves unparsable input', () => {
  const raw='2026-10-17T12:38:51.000Z';
  const expected=new Date(raw);
  const pad=(n:number)=>String(n).padStart(2,'0');
  expect(formatBuildTime(raw)).toBe(`${expected.getFullYear()}-${pad(expected.getMonth()+1)}-${pad(expected.getDate())} ${pad(expected.getHours())}:${pad(expected.getMinutes())}`);
  expect(formatBuildTime('not-a-date')).toBe('not-a-date');
  expect(formatBuildTime(undefined)).toBe('unbekannt');
});
