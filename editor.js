/*
 * Readme editor: CodeMirror 5 with WordPress readme highlighting and a
 * formatting toolbar. Falls back to the plain <textarea> if CodeMirror
 * didn't load (offline, CDN blocked), so the viewer always works.
 *
 *   var editor = ReadmeEditor.create(textarea, { toolbar: el, position: el });
 *   editor.get() / set(text) / onChange(fn) / setReadOnly(bool) / focus()
 *   editor.getScroll() / setScroll(px) / refresh()
 */
(function (root) {
	'use strict';

	var HEADER_KEY = /^(Contributors|Tags|Donate link|Requires at least|Tested up to|Requires PHP|Requires Plugins|Stable tag|License URI|License|Author URI|Author)\s*:/i;

	/* ---------- readme syntax on top of Markdown ---------- */

	function defineMode(CM) {
		if (CM.modes['wp-readme']) return;
		CM.defineMode('wp-readme', function (config) {
			var markdown = CM.getMode(config, { name: 'markdown', highlightFormatting: true });
			var overlay = {
				token: function (stream) {
					if (stream.sol()) {
						if (stream.match(/^\s*===.*===\s*$/)) return 'wp-title';
						if (stream.match(/^\s*==[^=].*==\s*$/)) return 'wp-section';
						if (stream.match(/^\s*=[^=].*=\s*$/)) return 'wp-sub';
						if (stream.match(HEADER_KEY)) return 'wp-key';
					}
					stream.skipToEnd();
					return null;
				}
			};
			return CM.overlayMode(markdown, overlay, true);
		});
	}

	/* ---------- formatting commands ---------- */

	function selectFrom(cm, pos, offset, length) {
		var start = cm.posFromIndex(cm.indexFromPos(pos) + offset);
		cm.setSelection(start, cm.posFromIndex(cm.indexFromPos(start) + length));
	}

	// **bold**, *italic*, `code`: wraps the selection, or unwraps it if already wrapped.
	function wrap(cm, mark, placeholder) {
		var sel = cm.getSelection();
		var from = cm.getCursor('from');
		if (sel.length > mark.length * 2 && sel.slice(0, mark.length) === mark && sel.slice(-mark.length) === mark) {
			var inner = sel.slice(mark.length, -mark.length);
			cm.replaceSelection(inner);
			selectFrom(cm, from, 0, inner.length);
			return;
		}
		var text = sel || placeholder;
		cm.replaceSelection(mark + text + mark);
		selectFrom(cm, from, mark.length, text.length);
	}

	function link(cm) {
		var sel = cm.getSelection();
		var from = cm.getCursor('from');
		if (/^https?:\/\/\S+$/.test(sel)) {
			cm.replaceSelection('[link text](' + sel + ')');
			selectFrom(cm, from, 1, 9);
		} else {
			var text = sel || 'link text';
			cm.replaceSelection('[' + text + '](https://)');
			selectFrom(cm, from, text.length + 3, 8);
		}
	}

	// Lists: adds the marker to every selected line, or removes it if all have it.
	function list(cm, ordered) {
		var re = ordered ? /^(\s*)\d+[.)]\s+/ : /^(\s*)[*+-]\s+/;
		var first = cm.getCursor('from').line;
		var last = cm.getCursor('to').line;
		var lines = [];
		for (var l = first; l <= last; l++) lines.push(cm.getLine(l));
		var remove = lines.every(function (t) { return re.test(t); });
		cm.operation(function () {
			lines.forEach(function (t, i) {
				var bare = t.replace(re, '$1').replace(ordered ? /^(\s*)[*+-]\s+/ : /^(\s*)\d+[.)]\s+/, '$1');
				var indent = bare.match(/^\s*/)[0];
				var next = remove ? bare : indent + (ordered ? (i + 1) + '. ' : '* ') + bare.slice(indent.length);
				cm.replaceRange(next, { line: first + i, ch: 0 }, { line: first + i, ch: t.length });
			});
		});
	}

	// == Section == and = Subsection =: wraps the current line, toggles off at the same level.
	function heading(cm, marks) {
		var l = cm.getCursor().line;
		var t = cm.getLine(l);
		var m = t.match(/^\s*(=+)\s*(.*?)\s*=+\s*$/);
		var inner = m ? m[2] : t.trim();
		var next;
		if (m && m[1] === marks) next = inner;
		else next = marks + ' ' + (inner || 'Heading') + ' ' + marks;
		cm.replaceRange(next, { line: l, ch: 0 }, { line: l, ch: t.length });
		if (next !== inner && !inner) selectFrom(cm, { line: l, ch: 0 }, marks.length + 1, 7);
	}

	var COMMANDS = {
		section: function (cm) { heading(cm, '=='); },
		subsection: function (cm) { heading(cm, '='); },
		bold: function (cm) { wrap(cm, '**', 'bold text'); },
		italic: function (cm) { wrap(cm, '*', 'italic text'); },
		code: function (cm) { wrap(cm, '`', 'code'); },
		link: link,
		bullets: function (cm) { list(cm, false); },
		numbers: function (cm) { list(cm, true); },
		find: function (cm) { cm.execCommand('find'); }
	};

	/* ---------- adapters ---------- */

	function codeMirrorEditor(ta, opts) {
		var CM = root.CodeMirror;
		defineMode(CM);
		var handlers = [];
		var toolbar = opts.toolbar;
		var pos = opts.position;

		function run(name) {
			return function (cm) {
				if (cm.getOption('readOnly')) return;
				COMMANDS[name](cm);
				cm.focus();
			};
		}

		var cm = CM.fromTextArea(ta, {
			mode: 'wp-readme',
			theme: 'readme',
			lineNumbers: true,
			lineWrapping: true,
			indentWithTabs: true,
			tabSize: 4,
			indentUnit: 4,
			styleActiveLine: true,
			placeholder: ta.getAttribute('placeholder') || '',
			extraKeys: {
				'Enter': 'newlineAndIndentContinueMarkdownList',
				'Tab': function (cm) {
					if (cm.somethingSelected() && cm.getSelection().indexOf('\n') !== -1) cm.indentSelection('add');
					else cm.replaceSelection('\t', 'end');
				},
				'Shift-Tab': 'indentLess',
				'Ctrl-B': run('bold'), 'Cmd-B': run('bold'),
				'Ctrl-I': run('italic'), 'Cmd-I': run('italic'),
				'Ctrl-K': run('link'), 'Cmd-K': run('link'),
				'Ctrl-E': run('code'), 'Cmd-E': run('code')
			}
		});

		cm.on('change', function (_, change) {
			if (change.origin === 'setValue') return; // programmatic loads render themselves
			handlers.forEach(function (h) { h(); });
		});

		if (pos) {
			cm.on('cursorActivity', function () {
				var c = cm.getCursor();
				pos.textContent = 'Ln ' + (c.line + 1) + ', Col ' + (c.ch + 1);
			});
		}

		if (toolbar) {
			toolbar.addEventListener('mousedown', function (e) {
				if (e.target.closest('[data-cmd]')) e.preventDefault(); // keep the selection
			});
			toolbar.addEventListener('click', function (e) {
				var b = e.target.closest('[data-cmd]');
				if (b && !b.disabled) run(b.getAttribute('data-cmd'))(cm);
			});
		}

		return {
			kind: 'codemirror',
			cm: cm,
			get: function () { return cm.getValue(); },
			set: function (v) {
				v = v == null ? '' : String(v);
				if (v === cm.getValue()) return;
				cm.setValue(v);
				cm.clearHistory();
			},
			onChange: function (fn) { handlers.push(fn); },
			setReadOnly: function (b) {
				cm.setOption('readOnly', !!b);
				cm.getWrapperElement().classList.toggle('is-readonly', !!b);
				if (toolbar) toolbar.querySelectorAll('[data-cmd]').forEach(function (btn) { btn.disabled = !!b; });
			},
			focus: function () { cm.focus(); },
			getScroll: function () { return cm.getScrollInfo().top; },
			setScroll: function (t) { cm.scrollTo(null, t); },
			refresh: function () { cm.refresh(); }
		};
	}

	function textareaEditor(ta, opts) {
		var handlers = [];
		if (opts.toolbar) opts.toolbar.hidden = true;
		ta.addEventListener('input', function () { handlers.forEach(function (h) { h(); }); });
		ta.addEventListener('keydown', function (e) {
			if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
				e.preventDefault();
				ta.setRangeText('\t', ta.selectionStart, ta.selectionEnd, 'end');
				handlers.forEach(function (h) { h(); });
			}
		});
		return {
			kind: 'textarea',
			get: function () { return ta.value; },
			set: function (v) { ta.value = v == null ? '' : String(v); },
			onChange: function (fn) { handlers.push(fn); },
			setReadOnly: function (b) { ta.readOnly = !!b; },
			focus: function () { ta.focus(); },
			getScroll: function () { return ta.scrollTop; },
			setScroll: function (t) { ta.scrollTop = t; },
			refresh: function () {}
		};
	}

	root.ReadmeEditor = {
		create: function (ta, opts) {
			opts = opts || {};
			var ready = root.CodeMirror && root.CodeMirror.overlayMode && root.CodeMirror.modes.markdown;
			return ready ? codeMirrorEditor(ta, opts) : textareaEditor(ta, opts);
		}
	};
})(window);
