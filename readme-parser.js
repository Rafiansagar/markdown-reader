/*
 * WordPress readme.txt parser + validator.
 * Works in the browser (window.WPReadme) and in Node (module.exports).
 */
(function (root) {
	'use strict';

	var SECTION_KEYS = {
		'description': 'description',
		'installation': 'installation',
		'frequently asked questions': 'faq',
		'faq': 'faq',
		'screenshots': 'screenshots',
		'changelog': 'changelog',
		'change log': 'changelog',
		'upgrade notice': 'upgrade_notice'
	};

	var HEADER_KEYS = {
		'contributors': 'contributors',
		'tags': 'tags',
		'donate link': 'donate_link',
		'requires at least': 'requires',
		'tested up to': 'tested',
		'requires php': 'requires_php',
		'stable tag': 'stable_tag',
		'license': 'license',
		'license uri': 'license_uri',
		'author': 'author',          // not read by wordpress.org; used here for the byline
		'author uri': 'author_uri',
		'requires plugins': 'requires_plugins'
	};

	/* ---------- helpers ---------- */

	function esc(s) {
		return String(s)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}

	function safeUrl(u) {
		u = String(u).trim();
		if (/^(https?:|mailto:|#|\/|\.\/)/i.test(u)) return u;
		if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return '#'; // javascript:, data:, etc.
		return u;
	}

	function indentOf(line) {
		return line.match(/^\s*/)[0].length;
	}

	/* ---------- inline markdown ---------- */

	function emphasis(t) {
		return t
			.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
			.replace(/__(?=\S)([\s\S]*?\S)__/g, '<strong>$1</strong>')
			.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
			.replace(/(^|[^*\w])\*(?=\S)([^*\n]*?\S)\*(?![*\w])/g, '$1<em>$2</em>')
			.replace(/(^|[^\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, '$1<em>$2</em>');
	}

	function inline(s) {
		var held = [];
		function hold(html) {
			held.push(html);
			return '\u0001' + (held.length - 1) + '\u0001';
		}

		// code spans
		s = s.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, function (_, ticks, code) {
			return hold('<code>' + esc(code.trim()) + '</code>');
		});
		// images
		s = s.replace(/!\[([^\]]*)\]\(\s*([^()\s]+(?:\([^()\s]*\)[^()\s]*)*)(?:\s+"[^"]*")?\s*\)/g, function (_, alt, url) {
			return hold('<img src="' + esc(safeUrl(url)) + '" alt="' + esc(alt) + '">');
		});
		// links
		s = s.replace(/\[([^\]]+)\]\(\s*([^()\s]+(?:\([^()\s]*\)[^()\s]*)*)(?:\s+"([^"]*)")?\s*\)/g, function (_, text, url, title) {
			return hold('<a href="' + esc(safeUrl(url)) + '"' + (title ? ' title="' + esc(title) + '"' : '') +
				'>' + emphasis(esc(text)) + '</a>');
		});
		// <https://autolinks>
		s = s.replace(/<((?:https?:\/\/|mailto:)[^>\s]+)>/g, function (_, url) {
			return hold('<a href="' + esc(safeUrl(url)) + '">' + esc(url.replace(/^mailto:/, '')) + '</a>');
		});
		// bare urls
		s = s.replace(/https?:\/\/[^\s<>"\u0001]*[^\s<>".,;:!?)\]'*_\u0001]/g, function (url) {
			return hold('<a href="' + esc(url) + '">' + esc(url) + '</a>');
		});

		s = emphasis(esc(s));
		s = s.replace(/ {2,}\n/g, '<br>\n');

		// restore (twice, link text may itself hold placeholders)
		for (var n = 0; n < 2; n++) {
			s = s.replace(/\u0001(\d+)\u0001/g, function (_, k) { return held[+k]; });
		}
		return s;
	}

	/* ---------- block markdown ---------- */

	var RE = {
		fence: /^\s*(```+|~~~+)\s*([\w+-]*)\s*$/,
		wpHeading: /^\s*=\s*(.+?)\s*=\s*$/,
		mdHeading: /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/,
		hr: /^\s{0,3}([-*_])(\s*\1){2,}\s*$/,
		quote: /^\s{0,3}>/,
		list: /^(\s*)([*+-]|\d+[.)])\s+(.*)$/,
		tableSep: /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/
	};

	function startsBlock(line) {
		return RE.fence.test(line) || RE.wpHeading.test(line) || RE.mdHeading.test(line) ||
			RE.hr.test(line) || RE.quote.test(line) || RE.list.test(line);
	}

	function dedent(lines) {
		var min = Infinity;
		lines.forEach(function (l) { if (l.trim()) min = Math.min(min, indentOf(l)); });
		if (!isFinite(min) || !min) return lines;
		return lines.map(function (l) { return l.slice(min); });
	}

	function splitRow(row) {
		row = row.trim().replace(/^\|/, '').replace(/\|$/, '');
		return row.split('|').map(function (c) { return c.trim(); });
	}

	function parseList(lines, i) {
		var first = lines[i].match(RE.list);
		var baseIndent = first[1].length;
		var ordered = /\d/.test(first[2]);
		var start = ordered ? parseInt(first[2], 10) : 1;
		var items = [];
		var cur = null;
		var loose = false;

		while (i < lines.length) {
			var line = lines[i];

			if (!line.trim()) {
				var j = i + 1;
				while (j < lines.length && !lines[j].trim()) j++;
				if (j >= lines.length) break;
				var nm = lines[j].match(RE.list);
				var nind = indentOf(lines[j]);
				var sameItem = nm && nm[1].length <= baseIndent + 1 && /\d/.test(nm[2]) === ordered;
				if (sameItem || nind > baseIndent + 1) {
					if (cur) cur.lines.push('');
					if (sameItem) loose = true;
					i = j;
					continue;
				}
				break;
			}

			var m = line.match(RE.list);
			var ind = indentOf(line);

			if (m && ind <= baseIndent + 1) {
				if (/\d/.test(m[2]) !== ordered) break; // switched list type
				cur = { lines: [m[3]], width: m[1].length + m[2].length + 1 };
				items.push(cur);
				i++;
				continue;
			}

			if (ind > baseIndent + 1) {
				cur.lines.push(line.slice(Math.min(ind, cur.width + 1)));
				i++;
				continue;
			}

			// lazy continuation of the previous line
			var prev = lines[i - 1];
			if (prev && prev.trim() && !startsBlock(line)) {
				cur.lines.push(line.trim());
				i++;
				continue;
			}
			break;
		}

		var html = items.map(function (it) {
			var inner = md(it.lines.join('\n'));
			if (!loose && it.lines.indexOf('') === -1) {
				inner = inner.replace(/^<p>([\s\S]*?)<\/p>/, '$1');
			}
			return '<li>' + inner + '</li>';
		}).join('');

		var tag = ordered ? 'ol' : 'ul';
		var attrs = ordered && start !== 1 ? ' start="' + start + '"' : '';
		return { html: '<' + tag + attrs + '>' + html + '</' + tag + '>', next: i };
	}

	function md(text) {
		var lines = String(text).replace(/\t/g, '    ').split('\n');
		var out = [];
		var i = 0;

		while (i < lines.length) {
			var line = lines[i];
			var m;

			if (!line.trim()) { i++; continue; }

			if ((m = line.match(RE.fence))) {
				var buf = [];
				i++;
				while (i < lines.length && lines[i].trim().indexOf(m[1]) !== 0) buf.push(lines[i++]);
				i++;
				out.push('<pre><code>' + esc(dedent(buf).join('\n')) + '</code></pre>');
				continue;
			}

			if ((m = line.match(RE.wpHeading))) {
				out.push('<h4>' + inline(m[1]) + '</h4>');
				i++;
				continue;
			}

			if ((m = line.match(RE.mdHeading))) {
				var lvl = m[1].length <= 2 ? 3 : m[1].length === 3 ? 4 : 5;
				out.push('<h' + lvl + '>' + inline(m[2]) + '</h' + lvl + '>');
				i++;
				continue;
			}

			if (RE.hr.test(line)) {
				out.push('<hr>');
				i++;
				continue;
			}

			if (RE.quote.test(line)) {
				var q = [];
				while (i < lines.length && lines[i].trim() && (RE.quote.test(lines[i]) || !startsBlock(lines[i]))) {
					q.push(lines[i].replace(/^\s{0,3}> ?/, ''));
					i++;
				}
				out.push('<blockquote>' + md(q.join('\n')) + '</blockquote>');
				continue;
			}

			if (RE.list.test(line)) {
				var list = parseList(lines, i);
				out.push(list.html);
				i = list.next;
				continue;
			}

			if (indentOf(line) >= 4) {
				var code = [];
				while (i < lines.length && (indentOf(lines[i]) >= 4 || !lines[i].trim())) code.push(lines[i++]);
				while (code.length && !code[code.length - 1].trim()) code.pop();
				out.push('<pre><code>' + esc(dedent(code).join('\n')) + '</code></pre>');
				continue;
			}

			if (line.indexOf('|') !== -1 && lines[i + 1] && RE.tableSep.test(lines[i + 1])) {
				var head = splitRow(line);
				var rows = [];
				i += 2;
				while (i < lines.length && lines[i].trim() && lines[i].indexOf('|') !== -1) rows.push(splitRow(lines[i++]));
				out.push('<table><thead><tr>' + head.map(function (c) { return '<th>' + inline(c) + '</th>'; }).join('') +
					'</tr></thead><tbody>' + rows.map(function (r) {
						return '<tr>' + r.map(function (c) { return '<td>' + inline(c) + '</td>'; }).join('') + '</tr>';
					}).join('') + '</tbody></table>');
				continue;
			}

			var para = [line];
			i++;
			while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) para.push(lines[i++]);
			out.push('<p>' + inline(para.map(function (l) { return l.replace(/^\s+/, ''); }).join('\n')) + '</p>');
		}

		return out.join('\n');
	}

	/* ---------- readme structure ---------- */

	// Splits a section body on "= Heading =" / "### Heading" lines.
	function splitSubsections(body) {
		var parts = [];
		var intro = [];
		var cur = null;
		body.split('\n').forEach(function (line) {
			var m = line.match(RE.wpHeading) || line.match(/^\s{0,3}#{3,4}\s+(.+?)\s*#*\s*$/);
			if (m) {
				cur = { title: m[m.length - 1].trim(), lines: [] };
				parts.push(cur);
			} else if (cur) {
				cur.lines.push(line);
			} else {
				intro.push(line);
			}
		});
		return {
			intro: intro.join('\n').trim(),
			items: parts.map(function (p) { return { title: p.title, body: p.lines.join('\n').trim() }; })
		};
	}

	function parseScreenshots(body) {
		var shots = [];
		var cur = null;
		body.split('\n').forEach(function (line) {
			var m = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
			if (m) {
				cur = { n: parseInt(m[1], 10), caption: m[2].trim() };
				shots.push(cur);
			} else if (cur && line.trim()) {
				cur.caption += ' ' + line.trim();
			}
		});
		return shots;
	}

	function parse(text) {
		text = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
		var lines = text.split('\n');
		var r = {
			name: '',
			nameLine: 0,
			headers: {},
			unknownHeaders: [],
			contributors: [],
			tags: [],
			short: '',
			sections: [],   // [{ key, title, body }]
			bySlug: {}
		};

		var i = 0;
		while (i < lines.length && !lines[i].trim()) i++;

		var nm = lines[i] && (lines[i].match(/^\s*===\s*(.+?)\s*===\s*$/) || lines[i].match(/^\s*#\s+(.+?)\s*#*\s*$/));
		if (nm) {
			r.name = nm[1].trim();
			r.nameLine = i + 1;
			i++;
		}

		while (i < lines.length && !lines[i].trim()) i++;

		// header fields
		for (; i < lines.length; i++) {
			var hm = lines[i].match(/^\s*([A-Za-z][A-Za-z ]*?)\s*:\s*(.*)$/);
			if (!hm || /^https?$/i.test(hm[1])) break;
			var key = hm[1].toLowerCase().replace(/\s+/g, ' ');
			if (HEADER_KEYS[key]) {
				r.headers[HEADER_KEYS[key]] = hm[2].trim();
			} else {
				r.unknownHeaders.push(hm[1]);
			}
		}

		var sectionRe = /^\s*==\s*(.+?)\s*==\s*$|^\s{0,3}##\s+(.+?)\s*#*\s*$/;

		// short description: everything before the first section
		var shortLines = [];
		for (; i < lines.length && !sectionRe.test(lines[i]); i++) shortLines.push(lines[i]);
		r.short = shortLines.join(' ').replace(/\s+/g, ' ').trim();

		// sections
		var cur = null;
		for (; i < lines.length; i++) {
			var sm = lines[i].match(sectionRe);
			if (sm) {
				var title = (sm[1] || sm[2]).trim();
				cur = { key: SECTION_KEYS[title.toLowerCase()] || 'other', title: title, lines: [] };
				r.sections.push(cur);
			} else if (cur) {
				cur.lines.push(lines[i]);
			}
		}
		r.sections.forEach(function (s) {
			s.body = s.lines.join('\n').replace(/^\n+|\s+$/g, '');
			delete s.lines;
			if (s.key !== 'other' && !r.bySlug[s.key]) r.bySlug[s.key] = s;
		});

		var h = r.headers;
		r.contributors = (h.contributors || '').split(',').map(function (c) { return c.trim(); }).filter(Boolean);
		r.tags = (h.tags || '').split(',').map(function (t) { return t.trim(); }).filter(Boolean);

		if (r.bySlug.faq) r.faq = splitSubsections(r.bySlug.faq.body);
		if (r.bySlug.screenshots) r.screenshots = parseScreenshots(r.bySlug.screenshots.body);
		if (r.bySlug.upgrade_notice) r.upgradeNotice = splitSubsections(r.bySlug.upgrade_notice.body);

		return r;
	}

	/* ---------- validator ---------- */

	function plainLength(s) {
		return s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '').length;
	}

	function validate(r, assets) {
		var out = [];
		function add(level, msg) { out.push({ level: level, msg: msg }); }
		var h = r.headers;

		if (!r.name) {
			add('error', 'No plugin name found. The first line should be <code>=== Plugin Name ===</code>.');
		} else if (/^plugin name$/i.test(r.name)) {
			add('warning', 'The plugin name is still the placeholder “Plugin Name”.');
		}

		if (!h.license) add('error', 'No <code>License:</code> header. WordPress.org needs a GPL-compatible license.');
		else if (!/gpl|mit|apache|bsd|mpl|isc|unlicense|wtfpl|lgpl/i.test(h.license)) add('warning', 'License “' + esc(h.license) + '” may not be GPL compatible.');
		if (h.license && !h.license_uri) add('info', 'No <code>License URI:</code> header.');

		if (!h.stable_tag) add('warning', 'No <code>Stable tag:</code> header. WordPress.org will serve trunk.');
		else if (/^trunk$/i.test(h.stable_tag)) add('warning', '<code>Stable tag: trunk</code> is not recommended. Use a version number that exists in /tags/.');

		if (!h.tested) add('warning', 'No <code>Tested up to:</code> header. The plugin will look untested in search.');
		else if (!/^\d+\.\d+(\.\d+)?$/.test(h.tested)) add('warning', '<code>Tested up to: ' + esc(h.tested) + '</code> should be a WordPress version like 6.7.');
		else if (/^\d+\.\d+\.\d+$/.test(h.tested)) add('info', '<code>Tested up to</code> only needs major.minor (e.g. ' + esc(h.tested.replace(/\.\d+$/, '')) + ').');

		if (!h.requires) add('warning', 'No <code>Requires at least:</code> header.');
		else if (!/^\d+\.\d+(\.\d+)?$/.test(h.requires)) add('warning', '<code>Requires at least: ' + esc(h.requires) + '</code> should be a version number.');
		if (!h.requires_php) add('info', 'No <code>Requires PHP:</code> header.');
		else if (!/^\d+\.\d+(\.\d+)?$/.test(h.requires_php)) add('warning', '<code>Requires PHP: ' + esc(h.requires_php) + '</code> should be a version number.');

		if (!r.contributors.length) add('warning', 'No <code>Contributors:</code> header.');
		r.contributors.forEach(function (c) {
			if (!/^[a-z0-9_.@-]+$/.test(c)) add('warning', 'Contributor “' + esc(c) + '” doesn’t look like a WordPress.org username (lowercase, no spaces).');
		});

		if (!r.tags.length) add('info', 'No <code>Tags:</code> header.');
		if (r.tags.length > 5) add('warning', r.tags.length + ' tags found. Only the first 5 are used: ' + r.tags.slice(5).map(esc).join(', ') + ' will be ignored.');

		if (h.donate_link && !/^https?:\/\//i.test(h.donate_link)) add('warning', '<code>Donate link</code> should be a full URL.');

		r.unknownHeaders.forEach(function (k) { add('info', 'Unknown header “' + esc(k) + '” is ignored.'); });
		if (h.author) add('info', 'The byline uses <code>Author:</code> from this readme. On wordpress.org it comes from the plugin file’s Author header, so keep the two the same.');
		if (h.author_uri && !/^https?:\/\//i.test(h.author_uri)) add('warning', '<code>Author URI</code> should be a full URL.');

		if (!r.short) {
			add('warning', 'No short description. Add one line between the headers and the first section.');
		} else {
			var len = plainLength(r.short);
			if (len > 150) add('warning', 'Short description is ' + len + ' characters. WordPress.org cuts it at 150.');
		}

		if (!r.bySlug.description) add('warning', 'No <code>== Description ==</code> section.');
		if (!r.bySlug.installation) add('info', 'No <code>== Installation ==</code> section.');
		if (!r.bySlug.faq) add('info', 'No <code>== Frequently Asked Questions ==</code> section.');
		if (!r.bySlug.changelog) add('info', 'No <code>== Changelog ==</code> section.');

		if (r.upgradeNotice) {
			r.upgradeNotice.items.forEach(function (it) {
				if (it.body.length > 300) add('warning', 'Upgrade notice for ' + esc(it.title) + ' is ' + it.body.length + ' characters. Keep it under 300.');
			});
		}

		if (r.screenshots && assets && assets.loaded) {
			r.screenshots.forEach(function (s) {
				if (!assets.screenshots[s.n]) add('info', 'Screenshot ' + s.n + ' has a caption but no screenshot-' + s.n + ' image was loaded.');
			});
		}

		var order = { error: 0, warning: 1, info: 2 };
		out.sort(function (a, b) { return order[a.level] - order[b.level]; });
		return out;
	}

	var api = { parse: parse, validate: validate, md: md, inline: inline, esc: esc };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	else root.WPReadme = api;
})(this);
