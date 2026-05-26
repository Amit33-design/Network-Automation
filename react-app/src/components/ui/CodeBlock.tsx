import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { StreamLanguage, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { oneDark } from '@codemirror/theme-one-dark';

// ─── Network CLI Stream Language ────────────────────────────────────────────

const netCLI = StreamLanguage.define({
  token(stream) {
    // Comments: !, #, //
    if (stream.match(/^[!#].*/) || stream.match(/^\/\/.*/)) {
      stream.skipToEnd();
      return 'comment';
    }
    // Strings
    if (stream.match(/^"[^"]*"/)) return 'string';
    // IPv4 / IPv6 addresses and prefixes
    if (stream.match(/^\d{1,3}(\.\d{1,3}){3}(\/\d+)?/)) return 'number';
    if (stream.match(/^[0-9a-fA-F:]+:[0-9a-fA-F:]+/)) return 'number';
    // Interface names (Ethernet, GigabitEthernet, loopback, etc.)
    if (stream.match(/^(interface|Ethernet|GigabitEthernet|TenGigabitEthernet|HundredGigE|FortyGigabitEthernet|Management|Loopback|Vlan|Port-channel|nve|Bundle-Ether)\S*/i)) return 'variableName';
    // "no" prefix
    if (stream.match(/^no\b/)) return 'deleted';
    // Network keywords
    if (stream.match(/^(router|bgp|ospf|isis|vrf|neighbor|network|address-family|policy|prefix-list|route-map|access-list|ip|ipv6|interface|hostname|feature|vlan|switchport|spanning-tree|ntp|logging|username|password|shutdown|description|set|match|permit|deny|community|local-pref|weight|med|as-path|redistribute|default-information|summary-address|aggregate-address|maximum-paths|timers|bfd|evpn|vxlan|vni|nve|tunnel|encapsulation|authentication|service|class-map|policy-map|qos|dscp|traffic-shaping|bandwidth|priority|queue|pfc|pause|ecn|flowcontrol|lldp|cdp|snmp|aaa|radius|tacacs|crypto|pki|certificate|ssh|telnet|http|https|boot|install|commit|rollback|checkpoint|configure|replace)\b/)) return 'keyword';
    // Numbers
    if (stream.match(/^\d+/)) return 'number';
    // Skip whitespace
    if (stream.eatSpace()) return null;
    stream.next();
    return null;
  },
});

const netHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: t.comment,       color: '#6b7280', fontStyle: 'italic' },
    { tag: t.string,        color: '#86efac' },
    { tag: t.number,        color: '#fbbf24' },
    { tag: t.keyword,       color: '#60a5fa', fontWeight: 'bold' },
    { tag: t.variableName,  color: '#a78bfa' },
    { tag: t.deleted,       color: '#f87171' },
  ])
);

// ─── Component ───────────────────────────────────────────────────────────────

interface CodeBlockProps {
  code: string;
  className?: string;
  maxHeight?: string;
}

export function CodeBlock({ code, className = '', maxHeight = '600px' }: CodeBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: code,
      extensions: [
        oneDark,
        netCLI,
        netHighlight,
        lineNumbers(),
        highlightActiveLine(),
        EditorState.readOnly.of(true),
        EditorView.lineWrapping,
        EditorView.theme({
          '&': { fontSize: '12px', fontFamily: "'JetBrains Mono','Fira Code',ui-monospace,monospace" },
          '.cm-scroller': { overflow: 'auto', maxHeight },
          '.cm-content': { padding: '8px 0' },
        }),
      ],
    });

    viewRef.current = new EditorView({ state, parent: containerRef.current });

    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update doc when code changes without recreating the editor
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === code) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: code },
    });
  }, [code]);

  return <div ref={containerRef} className={`rounded-lg overflow-hidden border border-slate-700 ${className}`} />;
}

// ─── Copy button helper ───────────────────────────────────────────────────────

export function CopyButton({ text, className = '' }: { text: string; className?: string }) {
  function copy() {
    navigator.clipboard.writeText(text).catch(() => undefined);
  }
  return (
    <button
      onClick={copy}
      className={`text-xs border border-slate-600 hover:border-slate-400 text-slate-400 hover:text-white px-3 py-1 rounded transition-colors ${className}`}
    >
      Copy
    </button>
  );
}
