// ==UserScript==
// @name         P2P Overlay Injector
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Inject p2p-overlay.js on a specific site
// @match        https://*/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    const script = document.createElement('script');
    script.src = 'https://arigadam.github.io/webmp/p2p-overlay.js';
    document.body.appendChild(script);
})();