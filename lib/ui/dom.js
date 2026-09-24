/**
 * Creates an element. Text only ever goes in through textContent.
 * @param {string} tag
 * @param {{className?: string, text?: string, attrs?: Record<string, string>}} [options]
 * @param {...(Node|null|undefined|false)} children
 * @returns {HTMLElement}
 */
export function el(tag, { className, text, attrs } = {}, ...children) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    if (attrs) {
        for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    }
    for (const child of children) {
        if (child) node.append(child);
    }
    return node;
}

/**
 * A core-styled button with a Font Awesome icon and an optional label.
 * @param {{icon: string, label?: string, className?: string, title?: string, onClick: () => void, disabled?: boolean}} options
 * @returns {HTMLButtonElement}
 */
export function iconButton({ icon, label, className = '', title, onClick, disabled = false }) {
    const button = /** @type {HTMLButtonElement} */ (el(
        'button',
        { className: `menu_button menu_button_icon ${className}`.trim(), attrs: { type: 'button' } },
        el('i', { className: `fa-solid ${icon} fa-fw`, attrs: { 'aria-hidden': 'true' } }),
        label ? el('span', { text: label }) : null,
    ));
    if (title) button.title = title;
    if (disabled) {
        button.disabled = true;
        button.classList.add('disabled');
    }
    button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
    });
    return button;
}
