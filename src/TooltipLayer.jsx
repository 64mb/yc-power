import React, {forwardRef, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Tooltip} from '@gravity-ui/uikit';

const ExternalAnchor = forwardRef(function ExternalAnchor({node, ...props}, ref) {
    useLayoutEffect(() => {
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
        return () => {
            if (typeof ref === 'function') ref(null);
            else if (ref) ref.current = null;
        };
    }, [node, ref]);
    const description = props['aria-describedby'];
    useLayoutEffect(() => {
        const previous = node.getAttribute('aria-describedby');
        if (description) node.setAttribute('aria-describedby', [previous, description].filter(Boolean).join(' '));
        return () => {
            if (previous === null) node.removeAttribute('aria-describedby');
            else node.setAttribute('aria-describedby', previous);
        };
    }, [node, description]);
    return null;
});

function hintFor(node) {
    if (!(node instanceof HTMLElement)) return null;
    const metadata = node.hasAttribute('data-ycp-tooltip') ? node : node.querySelector('[data-ycp-tooltip]');
    const content = metadata?.getAttribute('data-ycp-tooltip');
    return content ? {node, content} : null;
}

function containsFocus(node) {
    let focused = node.getRootNode().activeElement;
    while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
    return focused === node || Boolean(focused && node.contains(focused));
}

export function TooltipLayer({scope, style}) {
    const [container, setContainer] = useState(null);
    const [active, setActive] = useState(null);
    const pending = useRef(null);
    const timer = useRef(null);
    const dismissRef = useRef(() => {});

    useLayoutEffect(() => {
        const roots = new Set([scope || document, container?.getRootNode()].filter(Boolean));
        for (const root of roots) {
            for (const button of root.querySelectorAll('button')) {
                const hint = hintFor(button);
                if (hint && !button.hasAttribute('aria-label')) button.setAttribute('aria-label', hint.content);
            }
        }
        if (active) {
            const next = hintFor(active.node);
            if (!active.node.isConnected || !next) dismissRef.current();
            else if (next.content !== active.content) setActive(next);
        }
    });

    useEffect(() => {
        function dismiss() {
            clearTimeout(timer.current);
            pending.current = null;
            setActive(null);
        }
        dismissRef.current = dismiss;
        function resolve(event) {
            const path = event.composedPath();
            if (scope && !path.includes(scope) && !path.includes(container?.getRootNode())) return null;
            for (const node of path) {
                if (!(node instanceof HTMLElement)) continue;
                if (node.matches('button, a, span[data-ycp-tooltip]')) {
                    const hint = hintFor(node);
                    if (hint) {
                        const button = node.closest('button');
                        return button ? hintFor(button) : hint;
                    }
                }
                if (node === scope) break;
            }
            return null;
        }
        function enter(event) {
            if (event.pointerType === 'touch') return;
            const hint = resolve(event);
            if (!hint) { if (event.type === 'pointermove' && !(pending.current && containsFocus(pending.current))) dismiss(); return; }
            if (pending.current === hint.node) return;
            dismiss();
            pending.current = hint.node;
            timer.current = setTimeout(() => {
                if (hint.node.isConnected) setActive(hintFor(hint.node));
            }, 400);
        }
        function leave(event) {
            const node = pending.current;
            if (!node || resolve(event)?.node !== node) return;
            if (event.type === 'focusout' && node.matches(':hover')) return;
            if (event.type === 'pointerout' && containsFocus(node)) return;
            if (event.relatedTarget instanceof Node && node.contains(event.relatedTarget)) return;
            dismiss();
        }
        function keydown(event) {
            if (event.key === 'Escape') dismiss();
        }
        function scroll(event) {
            const node = pending.current;
            if (node && (event.target === document || event.target instanceof Element && event.target.contains(node))) dismiss();
        }
        const listeners = [['pointerover', enter], ['pointermove', enter], ['pointerout', leave], ['focusin', enter], ['focusout', leave], ['scroll', scroll], ['keydown', keydown]];
        const eventRoots = new Set([document, container?.getRootNode()].filter(Boolean));
        for (const eventRoot of eventRoots) for (const [name, handler] of listeners) eventRoot.addEventListener(name, handler, true);
        const observer = new MutationObserver(() => {
            const node = pending.current;
            if (!node) return;
            const hint = hintFor(node);
            if (!node.isConnected || !hint) dismiss();
            else setActive((current) => current && current.content !== hint.content ? hint : current);
        });
        const observedRoots = new Set([scope || document.documentElement, container?.getRootNode()].filter(Boolean));
        for (const observedRoot of observedRoots) observer.observe(observedRoot, {subtree: true, childList: true, attributes: true, attributeFilter: ['data-ycp-tooltip']});
        return () => {
            clearTimeout(timer.current);
            for (const eventRoot of eventRoots) for (const [name, handler] of listeners) eventRoot.removeEventListener(name, handler, true);
            observer.disconnect();
        };
    }, [scope, container]);

    return <div ref={setContainer} className="ycp-tooltip-layer" style={{...style, position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 10000}}>
        {container && active && <Tooltip open trigger="focus" content={active.content} container={container} strategy="fixed"
            className="ycp-tooltip" style={{fontFamily: style?.['--g-text-body-font-family'], maxWidth: 'min(360px, calc(100vw - 24px))', whiteSpace: 'pre-line', overflowWrap: 'anywhere'}}
            onOpenChange={(open) => { if (!open) dismissRef.current(); }}>
            <ExternalAnchor node={active.node}/>
        </Tooltip>}
    </div>;
}
