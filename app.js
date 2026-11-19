(function () {
	'use strict';

	var W = window.WPReadme;
	var esc = W.esc, md = W.md, inline = W.inline;

	var $src = document.getElementById('src');
	var $preview = document.getElementById('preview');
	var $issues = document.getElementById('issues');
	var $counts = document.getElementById('counts');
	var $card = document.getElementById('card');
	var $lightbox = document.getElementById('lightbox');

	var STORE_KEY = 'wp-readme-viewer:src';
	var VIEW_KEY = 'wp-readme-viewer:view';
	var state = { tab: 'details', openFaq: {} };
	var assets = { loaded: false, banner: null, bannerHigh: null, icon: null, screenshots: {} };

	var SAMPLE = [
		'=== Lightning Contact Form ===',
		'Contributors: janedoe, acmeplugins',
		'Donate link: https://example.com/donate',
		'Tags: contact form, forms, email, spam, gutenberg',
		'Requires at least: 6.2',
		'Tested up to: 6.7',
		'Requires PHP: 7.4',
		'Stable tag: 2.3.1',
		'License: GPLv2 or later',
		'License URI: https://www.gnu.org/licenses/gpl-2.0.html',
		'',
		'A fast, accessible contact form block with spam protection and email logging built in.',
		'',
		'== Description ==',
		'',
		'**Lightning Contact Form** adds a contact form block that works out of the box. No shortcodes, no settings maze.',
		'',
		'= Features =',
		'',
		'* Drag-and-drop fields inside the block editor',
		'* Honeypot and time-trap spam protection',
		'* Email log with resend, stored in your own database',
		'* Works with *any* SMTP plugin',
		'  * Nested items are supported too',
		'',
		'= Developers =',
		'',
		'Filter the recipient list with `lcf_recipients`:',
		'',
		'    add_filter( \'lcf_recipients\', function ( $to ) {',
		'        return array_merge( $to, [ \'sales@example.com\' ] );',
		'    } );',
		'',
		'Documentation lives at [our docs site](https://example.com/docs).',
		'',
		'== Installation ==',
		'',
		'1. Upload the plugin folder to `/wp-content/plugins/`, or install it from **Plugins → Add New**.',
		'2. Activate the plugin through the **Plugins** screen.',
		'3. Add the **Contact Form** block to any page.',
		'',
		'== Frequently Asked Questions ==',
		'',
		'= Does it work with classic themes? =',
		'',
		'Yes. Use the `[lightning_form]` shortcode anywhere the block editor isn’t available.',
		'',
		'= Where are messages stored? =',
		'',
		'In a custom table, `wp_lcf_log`. Nothing is sent to a third party.',
		'',
		'== Screenshots ==',
		'',
		'1. The form block in the editor.',
		'2. The email log screen with resend buttons.',
		'3. Spam protection settings.',
		'',
		'== Changelog ==',
		'',
		'= 2.3.1 =',
		'* Fix: honeypot field was visible in some block themes.',
		'',
		'= 2.3.0 =',
		'* New: email log export to CSV.',
		'* Improved: form validation messages are now announced to screen readers.',
		'',
		'== Upgrade Notice ==',
		'',
		'= 2.3.1 =',
		'Fixes a visible honeypot field in block themes. Recommended for everyone.',
		''
	].join('\n');

	/* ---------- helpers ---------- */

	function hash(s) {
		var h = 2166136261;
		for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
		return h >>> 0;
	}

	// Stand-in for the generated "geopattern" icon WordPress.org shows when no icon is uploaded.
	function patternIcon(name) {
		var h = hash(name || 'plugin');
		var hue = h % 360;
		var cells = '';
		for (var y = 0; y < 4; y++) {
			for (var x = 0; x < 4; x++) {
				var v = hash(name + x + ':' + y) % 100;
				var shape = v % 3;
				var op = (0.08 + (v % 7) * 0.05).toFixed(2);
				var fill = v % 2 ? '#fff' : '#000';
				var cx = x * 32 + 16, cy = y * 32 + 16;
				if (shape === 0) cells += '<circle cx="' + cx + '" cy="' + cy + '" r="14" fill="' + fill + '" fill-opacity="' + op + '"/>';
				else if (shape === 1) cells += '<rect x="' + (cx - 16) + '" y="' + (cy - 16) + '" width="32" height="32" fill="' + fill + '" fill-opacity="' + op + '"/>';
				else cells += '<path d="M' + (cx - 16) + ' ' + (cy + 16) + 'L' + cx + ' ' + (cy - 16) + 'L' + (cx + 16) + ' ' + (cy + 16) + 'Z" fill="' + fill + '" fill-opacity="' + op + '"/>';
			}
		}
		return '<svg viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="128" height="128" fill="hsl(' + hue + ',45%,48%)"/>' + cells + '</svg>';
	}

	function iconHtml(name) {
		return assets.icon ? '<img src="' + esc(assets.icon) + '" alt="">' : patternIcon(name);
	}

	function avatar(user) {
		var hue = hash(user) % 360;
		return '<span class="avatar" style="background:hsl(' + hue + ',40%,45%)">' + esc(user.charAt(0)) + '</span>';
	}

	function profile(user) {
		return 'https://profiles.wordpress.org/' + encodeURIComponent(user) + '/';
	}

	function section(title, html, id) {
		return '<section' + (id ? ' id="' + id + '"' : '') + '><h2>' + esc(title) + '</h2>' + html + '</section>';
	}

	/* ---------- render ---------- */

	function renderScreenshots(r) {
		var shots = r.screenshots || [];
		var extra = Object.keys(assets.screenshots).map(Number).filter(function (n) {
			return !shots.some(function (s) { return s.n === n; });
		});
		var all = shots.concat(extra.map(function (n) { return { n: n, caption: '' }; }))
			.sort(function (a, b) { return a.n - b.n; });
		if (!all.length) return '';
		return '<ul class="wp-shots">' + all.map(function (s) {
			var img = assets.screenshots[s.n];
			var media = img
				? '<button type="button" data-shot="' + s.n + '"><img src="' + esc(img) + '" alt="' + esc(s.caption) + '"></button>'
				: '<div class="ph">screenshot-' + s.n + '.png</div>';
			return '<li><figure style="margin:0">' + media +
				(s.caption ? '<figcaption>' + inline(s.caption) + '</figcaption>' : '') + '</figure></li>';
		}).join('') + '</ul>';
	}

	function renderFaq(r) {
		var f = r.faq;
		if (!f) return '';
		var html = f.intro ? md(f.intro) : '';
		if (f.items.length) {
			html += '<dl class="wp-faq">' + f.items.map(function (it, k) {
				var open = !!state.openFaq[it.title];
				return '<dt class="' + (open ? 'open' : '') + '"><button type="button" aria-expanded="' + open + '" data-faq="' + k + '">' +
					inline(it.title) + '</button></dt><dd' + (open ? '' : ' hidden') + '>' + md(it.body) + '</dd>';
			}).join('') + '</dl>';
		}
		return html;
	}

	function render() {
		var text = $src.value;
		var r = W.parse(text);
		var h = r.headers;
		var name = r.name || 'Untitled plugin';
		state.parsed = r;

		/* validator */
		var issues = W.validate(r, assets);
		var nErr = issues.filter(function (i) { return i.level === 'error'; }).length;
		var nWarn = issues.filter(function (i) { return i.level === 'warning'; }).length;
		var nInfo = issues.length - nErr - nWarn;
		var flagged = nErr + nWarn;
		var $badge = document.getElementById('checks-badge');
		$badge.className = 'badge ' + (nErr ? 'fail' : nWarn ? 'caution' : 'pass');
		$badge.textContent = flagged ? String(flagged) : '\u2713';
		$badge.setAttribute('aria-label', flagged ? flagged + ' to fix' : 'nothing to fix');
		function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
		var notes = nInfo ? plural(nInfo, 'note') + ' worth a look.' : '';
		$counts.innerHTML = flagged
			? '<strong>' + [nErr ? plural(nErr, 'error') : '', nWarn ? plural(nWarn, 'warning') : ''].filter(Boolean).join(' and ') + ' to fix</strong>' +
				(notes ? '<span>Plus ' + notes + '</span>' : '')
			: '<strong>Ready for wordpress.org</strong><span>' + (notes ? 'Nothing blocking. ' + notes : 'No problems found.') + '</span>';
		var SEV = { error: 'Error', warning: 'Warning', info: 'Note' };
		$issues.innerHTML = issues.map(function (i) {
			return '<li class="' + i.level + '"><span class="sev">' + SEV[i.level] + '</span><span>' + i.msg + '</span></li>';
		}).join('');

		/* search card */
		var short = r.short || '';
		var plain = short.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '');
		var cardText = plain.length > 150
			? esc(plain.slice(0, 150)) + '<span class="cut">' + esc(plain.slice(150)) + '</span>'
			: esc(plain || '—');
		$card.innerHTML = '<div class="search-card"><div class="icon">' + iconHtml(name) + '</div><div><h3>' + esc(name) +
			'</h3><p>' + cardText + '</p></div></div>';

		if (!text.trim()) {
			$preview.innerHTML = '<div class="wporg"><p class="wp-empty">Paste a readme.txt on the left, choose a source at the top, or drop a file onto the page.</p></div>';
			return;
		}

		/* details tab */
		var details = '';
		var desc = r.bySlug.description;
		details += section('Description', desc && desc.body ? md(desc.body) : '<p class="wp-empty">' + (short ? esc(short) : 'No description.') + '</p>', 'description');

		r.sections.forEach(function (s) {
			if (s.key === 'other') details += section(s.title, md(s.body));
		});

		var shots = renderScreenshots(r);
		if (shots) details += section('Screenshots', shots, 'screenshots');

		var faq = renderFaq(r);
		if (faq) details += section('FAQ', faq, 'faq');

		details += section('Reviews', '<p class="wp-empty">There are no reviews for this plugin.</p>', 'reviews-summary');

		var people = r.contributors.length
			? '<p>“' + esc(name) + '” is open source software. The following people have contributed to this plugin.</p>' +
				'<ul class="wp-people">' + r.contributors.map(function (c) {
					return '<li>' + avatar(c) + '<a href="' + profile(c) + '" target="_blank" rel="noopener">' + esc(c) + '</a></li>';
				}).join('') + '</ul>'
			: '<p class="wp-empty">No contributors listed.</p>';
		details += section('Contributors & Developers', people, 'developers');

		/* other tabs */
		var install = r.bySlug.installation && r.bySlug.installation.body
			? section('Installation', md(r.bySlug.installation.body))
			: section('Installation', '<p class="wp-empty">This section describes how to install the plugin and get it working.</p>');

		var reviews = section('Reviews', '<p class="wp-empty">There are no reviews for this plugin. Reviews come from WordPress.org users and are not part of readme.txt.</p>');

		var dev = section('Contributors & Developers', people) +
			section('Interested in development?', '<p>Browse the code, check out the SVN repository, or subscribe to the development log by RSS.</p>');
		if (r.bySlug.changelog) dev += section('Changelog', md(r.bySlug.changelog.body), 'changelog');
		if (r.upgradeNotice) {
			var un = r.upgradeNotice;
			dev += section('Upgrade Notice', (un.intro ? md(un.intro) : '') + un.items.map(function (it) {
				return '<h4>' + inline(it.title) + '</h4>' + md(it.body);
			}).join(''));
		}

		/* sidebar */
		function row(label, value) {
			return value
				? '<li><span>' + label + '</span><strong>' + value + '</strong></li>'
				: '<li class="na"><span>' + label + '</span><strong>—</strong></li>';
		}
		var version = h.stable_tag && !/^trunk$/i.test(h.stable_tag) ? esc(h.stable_tag) : '';
		var tags = r.tags.length
			? '<li><span>Tags</span><span class="wp-tags">' + r.tags.map(function (t, k) {
				return '<a href="#" class="' + (k >= 5 ? 'over' : '') + '" title="' + (k >= 5 ? 'Ignored: only 5 tags are used' : '') + '">' + esc(t) + '</a>';
			}).join('') + '</span></li>'
			: '';
		var sidebar =
			'<ul>' +
			row('Version', version) +
			row('Last updated', '') +
			row('Active installations', '') +
			row('WordPress version', h.requires ? esc(h.requires) + ' or higher' : '') +
			row('Tested up to', h.tested ? esc(h.tested) : '') +
			row('PHP version', h.requires_php ? esc(h.requires_php) + ' or higher' : '') +
			(h.requires_plugins ? row('Requires plugins', esc(h.requires_plugins)) : '') +
			row('Languages', '<a href="#">English (US)</a>') +
			tags +
			'</ul>' +
			'<a class="wp-advanced" href="#">Advanced View</a>' +
			'<div class="box"><h3>Ratings</h3><div class="stars" aria-label="No ratings">☆☆☆☆☆</div><p class="wp-empty" style="margin:4px 0 12px">No reviews have been submitted yet.</p>' +
			'<a class="wp-btn-outline" href="#">Add my review</a></div>' +
			(r.contributors.length ? '<div class="box"><h3>Contributors</h3><ul class="wp-people">' + r.contributors.map(function (c) {
				return '<li>' + avatar(c) + '<a href="' + profile(c) + '" target="_blank" rel="noopener">' + esc(c) + '</a></li>';
			}).join('') + '</ul></div>' : '') +
			'<div class="box"><h3>Support</h3><p>Got something to say? Need help?</p><a class="wp-btn-outline" href="#">View support forum</a></div>' +
			(h.donate_link ? '<div class="box"><h3>Donate</h3><p>Would you like to support the advancement of this plugin?</p><a class="wp-btn-outline" href="' +
				esc(/^https?:\/\//i.test(h.donate_link) ? h.donate_link : '#') + '" target="_blank" rel="noopener">Donate to this plugin</a></div>' : '');

		/* page */
		var banner = assets.bannerHigh || assets.banner;
		// Byline: the readme's Author line, else the first contributor.
		var by = '';
		if (h.author) {
			by = 'By ' + (h.author_uri && /^https?:\/\//i.test(h.author_uri)
				? '<a href="' + esc(h.author_uri) + '" target="_blank" rel="noopener">' + esc(h.author) + '</a>'
				: esc(h.author));
		} else if (r.contributors.length) {
			by = 'By <a href="' + profile(r.contributors[0]) + '" target="_blank" rel="noopener">' + esc(r.contributors[0]) + '</a>';
		}

		var tabs = [['details', 'Details'], ['reviews', 'Reviews'], ['installation', 'Installation'], ['development', 'Development']];

		var scroll = $preview.scrollTop;
		$preview.innerHTML =
			'<article class="wporg">' +
			(banner ? '<div class="wp-banner" style="background-image:url(&quot;' + esc(banner) + '&quot;)"></div>' : '') +
			'<header class="wp-header">' +
				'<div class="wp-icon">' + iconHtml(name) + '</div>' +
				'<div class="wp-title-wrap"><h1 class="wp-title">' + esc(name) + '</h1><div class="wp-byline">' + by + '</div></div>' +
				'<a class="wp-download" href="#">Download</a>' +
			'</header>' +
			'<nav class="wp-tabs" role="tablist">' + tabs.map(function (t) {
				return '<button type="button" role="tab" data-tab="' + t[0] + '" aria-selected="' + (state.tab === t[0]) + '">' + t[1] + '</button>';
			}).join('') + '<a class="support" href="#">Support</a></nav>' +
			'<div class="wp-grid">' +
				'<div class="wp-content">' +
					'<div class="wp-pane" data-pane="details"' + (state.tab === 'details' ? '' : ' hidden') + '>' + details + '</div>' +
					'<div class="wp-pane" data-pane="reviews"' + (state.tab === 'reviews' ? '' : ' hidden') + '>' + reviews + '</div>' +
					'<div class="wp-pane" data-pane="installation"' + (state.tab === 'installation' ? '' : ' hidden') + '>' + install + '</div>' +
					'<div class="wp-pane" data-pane="development"' + (state.tab === 'development' ? '' : ' hidden') + '>' + dev + '</div>' +
				'</div>' +
				'<aside class="wp-meta">' + sidebar + '</aside>' +
			'</div>' +
			'</article>';
		$preview.scrollTop = scroll;
	}

	/* ---------- events ---------- */

	var timer;
	$src.addEventListener('input', function () {
		clearTimeout(timer);
		timer = setTimeout(function () {
			render();
			try { localStorage.setItem(STORE_KEY, $src.value); } catch (e) {}
		}, 120);
	});

	$src.addEventListener('keydown', function (e) {
		if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
			e.preventDefault();
			var s = $src.selectionStart, en = $src.selectionEnd;
			$src.setRangeText('\t', s, en, 'end');
			$src.dispatchEvent(new Event('input'));
		}
	});

	$preview.addEventListener('click', function (e) {
		var t = e.target.closest('[data-tab]');
		if (t) {
			state.tab = t.getAttribute('data-tab');
			$preview.querySelectorAll('[data-tab]').forEach(function (b) { b.setAttribute('aria-selected', b === t); });
			$preview.querySelectorAll('[data-pane]').forEach(function (p) { p.hidden = p.getAttribute('data-pane') !== state.tab; });
			return;
		}
		var q = e.target.closest('[data-faq]');
		if (q) {
			var dt = q.parentNode, dd = dt.nextElementSibling;
			var open = dd.hidden;
			dd.hidden = !open;
			dt.classList.toggle('open', open);
			q.setAttribute('aria-expanded', open);
			state.openFaq[q.textContent] = open;
			return;
		}
		var shot = e.target.closest('[data-shot]');
		if (shot) {
			var n = +shot.getAttribute('data-shot');
			var cap = (state.parsed.screenshots || []).filter(function (s) { return s.n === n; })[0];
			$lightbox.querySelector('img').src = assets.screenshots[n];
			$lightbox.querySelector('p').innerHTML = cap ? n + '. ' + inline(cap.caption) : '';
			$lightbox.hidden = false;
			return;
		}
		var a = e.target.closest('a');
		if (a && a.getAttribute('href') === '#') e.preventDefault();
		else if (a && !a.target) a.target = '_blank';
	});

	$lightbox.addEventListener('click', function () { $lightbox.hidden = true; });
	document.addEventListener('keydown', function (e) { if (e.key === 'Escape') $lightbox.hidden = true; });

	function setView(v) {
		document.body.setAttribute('data-view', v);
		document.querySelectorAll('.seg [data-view]').forEach(function (b) {
			b.setAttribute('aria-pressed', b.getAttribute('data-view') === v);
		});
		try { localStorage.setItem(VIEW_KEY, v); } catch (e) {}
	}
	document.querySelectorAll('.seg [data-view]').forEach(function (b) {
		b.addEventListener('click', function () { setView(b.getAttribute('data-view')); });
	});

	/* files */

	function loadReadme(file) {
		var fr = new FileReader();
		fr.onload = function () {
			unlink(true);
			$src.value = fr.result;
			state.openFaq = {};
			render();
			try { localStorage.setItem(STORE_KEY, $src.value); } catch (e) {}
		};
		fr.readAsText(file);
	}

	function addAsset(file) {
		return addAssetUrl(file.name.toLowerCase(), URL.createObjectURL(file));
	}

	// Images that came with a linked source replace whatever was there before.
	function setLinkedAssets(map) {
		assets.banner = assets.bannerHigh = assets.icon = null;
		assets.screenshots = {};
		assets.loaded = false;
		Object.keys(map || {}).sort().forEach(function (n) { addAssetUrl(n, map[n]); });
	}

	function addAssetUrl(n, url) {
		var m;
		if (/^banner-1544x500\./.test(n)) assets.bannerHigh = url;
		else if (/^banner-772x250\./.test(n) || /^banner/.test(n)) assets.banner = url;
		else if (/^icon(-\d+x\d+)?\./.test(n)) {
			// prefer svg, then the larger png
			if (!assets.icon || /\.svg$/.test(n) || /256/.test(n)) assets.icon = url;
		} else if ((m = n.match(/^screenshot-(\d+)\./))) assets.screenshots[+m[1]] = url;
		else return false;
		assets.loaded = true;
		return true;
	}

	function handleFiles(files) {
		var skipped = [];
		Array.prototype.forEach.call(files, function (f) {
			if (/\.(txt|md|markdown)$/i.test(f.name) || f.type === 'text/plain') loadReadme(f);
			else if (/^image\//.test(f.type)) { if (!addAsset(f)) skipped.push(f.name); }
			else skipped.push(f.name);
		});
		render();
		if (skipped.length) alert('Not recognised (expected readme.txt, banner-*, icon-*, screenshot-N):\n\n' + skipped.join('\n'));
	}

	document.getElementById('btn-open').onclick = function () { document.getElementById('file-readme').click(); };
	document.getElementById('btn-assets').onclick = function () { document.getElementById('file-assets').click(); };
	document.getElementById('file-readme').onchange = function () { handleFiles(this.files); this.value = ''; };
	document.getElementById('file-assets').onchange = function () { handleFiles(this.files); this.value = ''; };
	document.getElementById('btn-sample').onclick = function () {
		if (!link && $src.value.trim() && $src.value !== SAMPLE && !confirm('Replace the current text with the sample readme?')) return;
		unlink(true);
		$src.value = SAMPLE;
		$src.dispatchEvent(new Event('input'));
	};
	document.getElementById('btn-copy').onclick = function () {
		var el = $preview.querySelector('.wporg');
		var btn = this;
		if (!el || !navigator.clipboard) return;
		navigator.clipboard.writeText(el.outerHTML).then(function () {
			btn.textContent = 'Copied';
			setTimeout(function () { btn.textContent = 'Copy HTML'; }, 1200);
		});
	};

	var depth = 0;
	window.addEventListener('dragenter', function (e) { e.preventDefault(); depth++; document.body.classList.add('dragging'); });
	window.addEventListener('dragleave', function () { if (--depth <= 0) { depth = 0; document.body.classList.remove('dragging'); } });
	window.addEventListener('dragover', function (e) { e.preventDefault(); });
	window.addEventListener('drop', function (e) {
		e.preventDefault();
		depth = 0;
		document.body.classList.remove('dragging');
		if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
	});

	/* resizable split */
	var WIDTH_KEY = 'wp-readme-viewer:left';
	var $gutter = document.getElementById('gutter');
	var $workspace = document.querySelector('.workspace');

	function setLeft(px, save) {
		var max = $workspace.clientWidth - 320;
		px = Math.round(Math.max(240, Math.min(px, max)));
		$workspace.style.setProperty('--left', px + 'px');
		$gutter.setAttribute('aria-valuenow', px);
		if (save) { try { localStorage.setItem(WIDTH_KEY, px); } catch (e) {} }
	}

	$gutter.addEventListener('pointerdown', function (e) {
		if (e.button !== 0) return;
		e.preventDefault();
		$gutter.setPointerCapture(e.pointerId);
		document.body.classList.add('resizing');
		var left = $workspace.getBoundingClientRect().left;
		function move(ev) { setLeft(ev.clientX - left - 4, false); }
		function up(ev) {
			setLeft(ev.clientX - left - 4, true);
			document.body.classList.remove('resizing');
			$gutter.removeEventListener('pointermove', move);
			$gutter.removeEventListener('pointerup', up);
			$gutter.removeEventListener('pointercancel', up);
		}
		$gutter.addEventListener('pointermove', move);
		$gutter.addEventListener('pointerup', up);
		$gutter.addEventListener('pointercancel', up);
	});

	$gutter.addEventListener('dblclick', function () {
		$workspace.style.removeProperty('--left');
		try { localStorage.removeItem(WIDTH_KEY); } catch (e) {}
	});

	$gutter.addEventListener('keydown', function (e) {
		if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
		e.preventDefault();
		var cur = document.querySelector('.editor-pane').getBoundingClientRect().width;
		setLeft(cur + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 80 : 20), true);
	});

	window.addEventListener('resize', function () {
		if ($workspace.style.getPropertyValue('--left')) setLeft(parseFloat($workspace.style.getPropertyValue('--left')), false);
	});

	/* left pane tabs */
	var SIDE_KEY = 'wp-readme-viewer:side';
	var sideTabs = document.querySelectorAll('[data-side]');

	function setSide(name) {
		sideTabs.forEach(function (b) { b.setAttribute('aria-selected', b.getAttribute('data-side') === name); });
		document.querySelectorAll('[data-pane-side]').forEach(function (v) { v.hidden = v.getAttribute('data-pane-side') !== name; });
		try { localStorage.setItem(SIDE_KEY, name); } catch (e) {}
	}
	sideTabs.forEach(function (b) { b.addEventListener('click', function () { setSide(b.getAttribute('data-side')); }); });

	/* preview parts: header, tabs, sidebar */
	var BLOCKS_KEY = 'wp-readme-viewer:hidden';
	var toggles = document.querySelectorAll('.toggle[data-block]');

	function applyBlocks(save) {
		var hidden = [];
		toggles.forEach(function (t) {
			var name = t.getAttribute('data-block');
			var on = t.getAttribute('aria-pressed') === 'true';
			document.body.classList.toggle('hide-' + name, !on);
			if (!on) hidden.push(name);
		});
		if (save) { try { localStorage.setItem(BLOCKS_KEY, hidden.join(',')); } catch (e) {} }
	}
	toggles.forEach(function (t) {
		t.addEventListener('click', function () {
			t.setAttribute('aria-pressed', t.getAttribute('aria-pressed') !== 'true');
			applyBlocks(true);
		});
	});

	/* init */
	var saved = null, savedView = null, savedLeft = null, savedSide = null, savedHidden = '';
	try {
		saved = localStorage.getItem(STORE_KEY);
		savedView = localStorage.getItem(VIEW_KEY);
		savedLeft = localStorage.getItem(WIDTH_KEY);
		savedSide = localStorage.getItem(SIDE_KEY);
		savedHidden = localStorage.getItem(BLOCKS_KEY) || '';
	} catch (e) {}
	toggles.forEach(function (t) { t.setAttribute('aria-pressed', savedHidden.split(',').indexOf(t.getAttribute('data-block')) === -1); });
	applyBlocks(false);
	if (savedLeft) setLeft(+savedLeft, false);
	if (savedSide) setSide(savedSide);
	$src.value = saved != null ? saved : SAMPLE;
	if (savedView) setView(savedView);
	render();

	/* source: a folder or file on this PC, or a URL */
	var SOURCE_KEY = 'wp-readme-viewer:source';
	var LIVE_KEY = 'wp-readme-viewer:live';
	var $pill = document.getElementById('source-pill');
	var $pop = document.getElementById('source-pop');
	var $pillMain = document.getElementById('pill-main');
	var $pillSub = document.getElementById('pill-sub');
	var $pillState = document.getElementById('pill-state');
	var $srcInput = document.getElementById('source-input');
	var $live = document.getElementById('live');
	var $unlink = document.getElementById('btn-unlink');
	var $status = document.getElementById('src-status');
	var $note = document.getElementById('pane-note');
	var hasServer = false;
	var link = null; // { src, live, es, timer }

	function openPop(open) {
		$pop.hidden = !open;
		$pill.setAttribute('aria-expanded', open);
		if (open) { $srcInput.focus(); $srcInput.select(); }
	}
	$pill.addEventListener('click', function () { openPop($pop.hidden); });
	document.addEventListener('click', function (e) {
		if (!$pop.hidden && !$pop.contains(e.target) && !$pill.contains(e.target)) openPop(false);
	});
	document.addEventListener('keydown', function (e) {
		if (e.key === 'Escape' && !$pop.hidden) { openPop(false); $pill.focus(); }
	});
	['btn-open', 'btn-assets', 'btn-sample'].forEach(function (id) {
		document.getElementById(id).addEventListener('click', function () { openPop(false); });
	});

	// Short, human name for a source: folder + file, or site + page.
	function describe(src) {
		if (!src) return { main: 'Pasted text', sub: '' };
		var m = src.match(/wordpress\.org\/plugins\/([a-z0-9-]+)/i);
		if (m) return { main: m[1], sub: 'on wordpress.org' };
		if (/^https?:\/\//i.test(src)) {
			try {
				var u = new URL(src);
				var parts = u.pathname.split('/').filter(Boolean);
				return { main: parts.length ? decodeURIComponent(parts[parts.length - 1]) : u.host, sub: 'on ' + u.host };
			} catch (e) { return { main: src, sub: '' }; }
		}
		var segs = src.replace(/[\\/]+$/, '').split(/[\\/]/);
		var last = segs[segs.length - 1];
		if (/\.(txt|md|markdown)$/i.test(last)) return { main: segs[segs.length - 2] || last, sub: '/ ' + last };
		return { main: last, sub: '/ readme.txt' };
	}

	function setPill(state, stateText) {
		var d = describe(link ? link.src : '');
		$pill.setAttribute('data-state', state);
		$pillMain.textContent = d.main;
		$pillSub.textContent = d.sub;
		$pillState.textContent = stateText;
		$pill.title = link ? link.src : 'Choose where the readme comes from';
	}

	function setNote(kind, html) {
		if (!kind) { $note.hidden = true; return; }
		$note.hidden = false;
		$note.className = 'pane-note' + (kind === 'err' ? ' err' : '');
		$note.innerHTML = '<p>' + html + '</p>' +
			(kind === 'err'
				? '<button type="button" class="btn" data-note="source">Change source</button>'
				: '<button type="button" class="btn" data-note="unlink">Unlink</button>');
	}
	$note.addEventListener('click', function (e) {
		var b = e.target.closest('[data-note]');
		if (!b) return;
		if (b.getAttribute('data-note') === 'unlink') doUnlink();
		else { e.stopPropagation(); openPop(true); }
	});

	function setStatus(kind, html) {
		$status.className = 'pop-status' + (kind === 'err' ? ' err' : '');
		$status.innerHTML = html || '';
		if (kind === 'err') {
			setPill('err', 'Can’t read');
			setNote('err', html);
		} else if (kind === 'busy') {
			setPill('busy', 'Reading…');
		}
	}

	function idleStatus() {
		setPill('idle', 'Change source');
		setNote(null);
		setStatus('idle', hasServer ? '' :
			'Files on this PC need the local server. Run <code>node server.js</code> in the viewer folder, then open <code>http://localhost:4321</code>. Without it, only URLs from sites that allow it can be read.');
	}

	function applyPayload(mine, p) {
		if (link !== mine) return;
		var top = $src.scrollTop;
		$src.value = p.text;
		$src.scrollTop = top;
		if (p.assets) setLinkedAssets(p.assets);
		render();
		var time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
		var n = p.assets ? Object.keys(p.assets).length : 0;
		setPill(mine.live ? 'live' : 'ok', mine.live ? 'Live' : 'Read at ' + time);
		$status.className = 'pop-status';
		$status.innerHTML = 'Read <code>' + esc(p.file || p.url || p.label) + '</code> at ' + time +
			(n ? ', with ' + n + ' image' + (n === 1 ? '' : 's') : '') + '.';
		setNote('info', mine.live
			? 'Read-only while linked. Save the file in your editor and the preview updates.'
			: 'Read-only while linked. Save the file in your editor, then reload this page.');
	}

	function unlink(forget) {
		if (link) {
			if (link.es) link.es.close();
			clearInterval(link.timer);
		}
		link = null;
		$src.readOnly = false;
		document.body.classList.remove('linked');
		$unlink.hidden = true;
		if (forget) {
			try { localStorage.removeItem(SOURCE_KEY); } catch (e) {}
			idleStatus();
		}
	}

	function doUnlink() {
		unlink(true);
		try { localStorage.setItem(STORE_KEY, $src.value); } catch (e) {}
		$src.focus();
	}

	// Same page-to-raw rewrites as the server, for static mode.
	function directUrl(u) {
		var m;
		if ((m = u.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/i))) return 'https://raw.githubusercontent.com/' + m[1] + '/' + m[2] + '/' + m[3];
		if ((m = u.match(/^https?:\/\/(?:[\w-]+\.)?wordpress\.org\/plugins\/([a-z0-9-]+)/i))) return 'https://plugins.svn.wordpress.org/' + m[1] + '/trunk/readme.txt';
		return u;
	}

	function linkTo(src) {
		src = (src || '').trim().replace(/^["']+|["']+$/g, '');
		if (!src) { openPop(true); return; }
		unlink(false);
		var mine = link = { src: src, live: $live.checked };
		try { localStorage.setItem(SOURCE_KEY, src); } catch (e) {}
		$src.readOnly = true;
		document.body.classList.add('linked');
		$unlink.hidden = false;
		setStatus('busy', 'Reading <code>' + esc(src) + '</code>…');

		function fail(e) {
			if (link !== mine) return;
			var msg = e && e.message === 'Failed to fetch'
				? (hasServer
					? 'The local server stopped. Start it again with <code>node server.js</code>.'
					: 'That site doesn’t allow the browser to read it directly. Run <code>node server.js</code> to read any URL.')
				: esc(e && e.message ? e.message : String(e));
			setStatus('err', msg);
		}

		if (hasServer) {
			var q = encodeURIComponent(src);
			fetch('api/read?src=' + q, { cache: 'no-store' })
				.then(function (r) { return r.json().then(function (p) { if (!r.ok) throw new Error(p.error); return p; }); })
				.then(function (p) {
					applyPayload(mine, p);
					if (!mine.live || link !== mine) return;
					mine.es = new EventSource('api/watch?src=' + q);
					mine.es.onmessage = function (e) { applyPayload(mine, JSON.parse(e.data)); };
					mine.es.addEventListener('problem', function (e) { fail(new Error(JSON.parse(e.data).error)); });
					mine.es.onerror = function () {
						if (link === mine) { setPill('err', 'Reconnecting…'); }
					};
				})
				.catch(function (e) {
					fail(e);
					$src.readOnly = false;
				});
			return;
		}

		if (!/^https?:\/\//i.test(src)) {
			fail(new Error('A folder or file on this PC needs the local server. Run "node server.js" in the viewer folder, then open http://localhost:4321'));
			$src.readOnly = false;
			return;
		}

		var url = directUrl(src);
		function load() {
			return fetch(url, { cache: 'no-store' })
				.then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url); return r.text(); })
				.then(function (t) {
					if (t !== $src.value || !mine.loaded) {
						mine.loaded = true;
						applyPayload(mine, { text: t, label: src, url: url, assets: null });
					}
				});
		}
		load().then(function () {
			if (mine.live && link === mine) mine.timer = setInterval(function () { load().catch(fail); }, 5000);
		}).catch(function (e) {
			fail(e);
			$src.readOnly = false;
		});
	}

	document.getElementById('source-form').addEventListener('submit', function (e) {
		e.preventDefault();
		openPop(false);
		linkTo($srcInput.value);
	});
	$unlink.addEventListener('click', function () { openPop(false); doUnlink(); });
	$live.addEventListener('change', function () {
		try { localStorage.setItem(LIVE_KEY, $live.checked ? '1' : '0'); } catch (e) {}
		if (link) linkTo(link.src);
	});

	var savedSource = null;
	try {
		savedSource = localStorage.getItem(SOURCE_KEY);
		if (localStorage.getItem(LIVE_KEY) === '0') $live.checked = false;
	} catch (e) {}
	// ?src=… in the address wins, so a source can be bookmarked.
	var fromQuery = new URLSearchParams(location.search).get('src');
	if (fromQuery) savedSource = fromQuery;
	if (savedSource) $srcInput.value = savedSource;
	idleStatus();

	(location.protocol === 'file:'
		? Promise.resolve(false)
		: fetch('api/ping', { cache: 'no-store' }).then(function (r) { return r.ok; }, function () { return false; })
	).then(function (ok) {
		hasServer = ok;
		if (savedSource) linkTo(savedSource);
		else idleStatus();
	});
})();
