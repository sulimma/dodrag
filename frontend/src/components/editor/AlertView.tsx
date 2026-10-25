import React from 'react';
import { NodeViewWrapper, NodeViewContent, type NodeViewProps } from '@tiptap/react';
import { t, useLanguage } from '../../i18n';
import { ALERT_TYPES } from './MarkdownFeatures';

export function AlertView({ node }: NodeViewProps) {
  useLanguage();
  const item = ALERT_TYPES.find(item => item.type === node.attrs.type) ?? ALERT_TYPES[0];
  return <NodeViewWrapper data-alert={item.type}>
    <div className="alert-title" contentEditable={false}><span aria-hidden="true">{item.icon}</span><span>{t(item.labelKey)}</span></div>
    <NodeViewContent data-alert-content="" />
  </NodeViewWrapper>;
}
