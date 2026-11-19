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

	// ![alt text](url): selects the URL to type, or the alt text if a URL was selected.
	function image(cm) {
		var sel = cm.getSelection();
		var from = cm.getCursor('from');
		if (/^(https?:\/\/|\.{0,2}\/|[\w-]+\/)\S*\.(png|jpe?g|gif|svg|webp|avif)$/i.test(sel) || /^https?:\/\/\S+$/.test(sel)) {
			cm.replaceSelection('![alt text](' + sel + ')');
			selectFrom(cm, from, 2, 8);
		} else {
			var alt = sel || 'alt text';
			cm.replaceSelection('![' + alt + '](https://)');
			selectFrom(cm, from, alt.length + 4, 8);
		}
	}

	// Table: turns selected tab- or comma-separated lines into a table (first line = header),
	// otherwise inserts a 2-column starter on its own lines.
	function table(cm) {
		var sel = cm.getSelection();
		var rows = sel.split('\n').filter(function (l) { return l.trim(); });
		var sep = /\t/.test(sel) ? '\t' : /,/.test(sel) ? ',' : null;
		var lines;
		if (sep && rows.length > 1) {
			var cells = rows.map(function (r) { return r.split(sep).map(function (c) { return c.trim(); }); });
			var cols = Math.max.apply(null, cells.map(function (c) { return c.length; }));
			var line = function (c) {
				var out = [];
				for (var k = 0; k < cols; k++) out.push(c[k] || '');
				return '| ' + out.join(' | ') + ' |';
			};
			lines = [line(cells[0]), '|' + new Array(cols + 1).join(' --- |')].concat(cells.slice(1).map(line));
		} else {
			lines = ['| Column | Column |', '| --- | --- |', '| Cell | Cell |'];
		}

		// Tables need a blank line before and after.
		var from = cm.getCursor('from');
		var to = cm.getCursor('to');
		var before = '';
		if (cm.getLine(from.line).slice(0, from.ch).trim()) before = '\n\n'; // text before the cursor
		else if (from.line > 0 && cm.getLine(from.line - 1).trim()) before = '\n'; // text on the line above
		var after = '';
		if (cm.getLine(to.line).slice(to.ch).trim()) after = '\n\n'; // text after the cursor
		else if (to.line < cm.lastLine() && cm.getLine(to.line + 1).trim()) after = '\n'; // text on the line below
		var text = lines.join('\n');
		cm.replaceSelection(before + text + after);
		if (!sep || rows.length < 2) selectFrom(cm, from, before.length + 2, 6); // first "Column"
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

	// ## Heading and ### Heading for GitHub / Plain Markdown.
	function mdHeading(cm, hashes) {
		var l = cm.getCursor().line;
		var t = cm.getLine(l);
		var m = t.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
		var inner = m ? m[2] : t.trim();
		var next = m && m[1] === hashes ? inner : hashes + ' ' + (inner || 'Heading');
		cm.replaceRange(next, { line: l, ch: 0 }, { line: l, ch: t.length });
		if (!inner) selectFrom(cm, { line: l, ch: 0 }, hashes.length + 1, 7);
	}

	function isWp(cm) { return (cm.state.readmeApp || 'wp') === 'wp'; }

	// Toolbar heading buttons per app.
	var HEADING_LABELS = {
		wp: { section: ['==', 'Section: == Title =='], subsection: ['=', 'Subsection or FAQ question: = Title ='] },
		md: { section: ['##', 'Heading: ## Title'], subsection: ['###', 'Subheading: ### Title'] }
	};

	function labelToolbar(toolbar, app) {
		if (!toolbar) return;
		var set = HEADING_LABELS[app === 'wp' ? 'wp' : 'md'];
		Object.keys(set).forEach(function (cmd) {
			var b = toolbar.querySelector('[data-cmd="' + cmd + '"]');
			if (b) { b.textContent = set[cmd][0]; b.title = set[cmd][1]; }
		});
	}

	var COMMANDS = {
		section: function (cm) { if (isWp(cm)) heading(cm, '=='); else mdHeading(cm, '##'); },
		subsection: function (cm) { if (isWp(cm)) heading(cm, '='); else mdHeading(cm, '###'); },
		bold: function (cm) { wrap(cm, '**', 'bold text'); },
		italic: function (cm) { wrap(cm, '*', 'italic text'); },
		code: function (cm) { wrap(cm, '`', 'code'); },
		link: link,
		image: image,
		table: table,
		bullets: function (cm) { list(cm, false); },
		numbers: function (cm) { list(cm, true); },
		// Persistent bar: Enter = next, Shift+Enter = previous, Esc closes.
		find: function (cm) { cm.execCommand('findPersistent'); }
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
				if (name === 'find') { COMMANDS.find(cm); return; } // works read-only; focusing the editor would close the bar
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
				'Shift-Ctrl-I': run('image'), 'Shift-Cmd-I': run('image'),
				'Ctrl-E': run('code'), 'Cmd-E': run('code'),
				'Ctrl-F': run('find'), 'Cmd-F': run('find')
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
				if (toolbar) toolbar.querySelectorAll('[data-cmd]').forEach(function (btn) { btn.disabled = !!b && btn.getAttribute('data-cmd') !== 'find'; });
			},
			focus: function () { cm.focus(); },
			getScroll: function () { return cm.getScrollInfo().top; },
			setScroll: function (t) { cm.scrollTo(null, t); },
			refresh: function () { cm.refresh(); },
			// 'wp' = readme.txt syntax on top of Markdown; 'github' / 'plain' = Markdown only
			setApp: function (app) {
				cm.state.readmeApp = app;
				cm.setOption('mode', app === 'wp' ? 'wp-readme' : { name: 'markdown', highlightFormatting: true });
				labelToolbar(toolbar, app);
			}
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
			refresh: function () {},
			setApp: function () {}
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
