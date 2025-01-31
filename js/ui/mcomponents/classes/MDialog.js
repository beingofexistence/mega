class MDialog extends MComponent {
    /**
     * @param {Object.<String, any>} data An enclosing data object
     * @param {Boolean|{label: String, callback: Function?}} data.ok Either boolean for show/hide or an object
     * @param {Boolean|{label: String, callback: Function?}} data.cancel Either boolean for show/hide or an object
     * @param {String} [data.dialogClasses] Additional classes for dialog
     * @param {String} [data.contentClasses] Additional classes for dialog content
     * @param {String} [data.leftIcon] Classes for the side icon on the left
     */
    constructor({ ok, cancel, dialogClasses, contentClasses, leftIcon }) {
        super('section.mega-dialog-container:not(.common-container)', false);

        this._ok = ok;
        this._cancel = cancel;
        this._dialogClasses = 'hidden' + (typeof dialogClasses === 'string' ? ' ' + dialogClasses : '');
        this._contentClasses = contentClasses;

        this._title = document.createElement('h3');
        this._title.className = 'text-ellipsis';

        if (leftIcon) {
            this.leftIcon = document.createElement('i');
            this.leftIcon.className = 'icon-left ' + leftIcon;
        }
    }

    get slot() {
        return this._slot;
    }

    /**
     * Providing the internal contents of the dialog
     * @param {HTMLElement} slot DOM element to insert within the dialog
     * @returns {void}
     */
    set slot(slot) {
        this._slot = slot;
    }

    /**
     * Filling the title text
     * @param {String} text Text to fill the title with
     * @returns {void}
     */
    set title(text) {
        this._title.textContent = text;
    }

    /**
     * Filling the text underneath the dialog
     * @param {String} text Text to fill with
     * @returns {void}
     */
    set actionTitle(text) {
        this._actionTitle.textContent = text;
    }

    buildElement() {
        this.el = document.createElement('div');
    }

    triggerCancelAction() {
        if (typeof this._cancel === 'function') {
            this._cancel();
        }
        else if (this._cancel.callback) {
            this._cancel.callback();
        }

        this.hide();
    }

    show() {
        this.setWrapper();
        this.setButtons();

        if (this._parent) {
            this._parent.append(this.el);

            const overlay = this._parent.querySelector('.fm-dialog-overlay');
            overlay.classList.add('m-dialog-overlay');

            const disposeClick = MComponent.listen(overlay, 'click', () => {
                this.hide();
                disposeClick();
            });

            const disposeEsc = MComponent.listen(document, 'keyup', ({ key }) => {
                if (key === 'Escape') {
                    this.hide();
                    disposeEsc();
                }
            });
        }

        if (this._slot) {
            this._contentWrapper.append(this._slot);
        }

        if (this.leftIcon) {
            this.el.prepend(this.leftIcon);
            this.el.classList.add('pl-18');
            this._contentWrapper.classList.add('px-6');
        }
        else {
            this.el.classList.remove('pl-18');
            this._contentWrapper.classList.remove('px-6');
        }

        M.safeShowDialog('m-dialog', $(this.el));
    }

    hide() {
        this.detachEl();

        assert($.dialog === 'm-dialog');
        closeDialog();

        if (this.disposeCloseClick) {
            this.disposeCloseClick();
        }

        if (this.disposeEnterHit) {
            this.disposeEnterHit();
        }
    }

    disable() {
        if (this.okBtn && !this.okBtn.el.disabled) {
            this.okBtn.disable();
        }
    }

    enable() {
        if (this.okBtn && this.okBtn.el.disabled === true) {
            this.okBtn.enable();
        }
    }

    setWrapper() {
        let className = 'mega-dialog m-dialog dialog-template-main';

        this.el = document.createElement('div');

        if (typeof this._dialogClasses === 'string') {
            className += ' ' + this._dialogClasses;
        }

        this.el.className = className;

        const closeBtn = document.createElement('button');
        closeBtn.className = 'close m-dialog-close';
        this.el.append(closeBtn);

        const closeIcon = document.createElement('i');
        closeIcon.className = 'sprite-fm-mono icon-dialog-close';
        closeBtn.append(closeIcon);

        this.el.append(this._title);

        const content = document.createElement('section');
        content.className = 'content';
        this.el.append(content);

        this._contentWrapper = document.createElement('div');
        this._contentWrapper.className = (typeof this._contentClasses === 'string') ? this._contentClasses : '';
        content.append(this._contentWrapper);

        this.disposeCloseClick = MComponent.listen(closeBtn, 'click', () => {
            this.triggerCancelAction();
        });
    }

    setButtons() {
        const footer = document.createElement('footer');
        const footerContainer = document.createElement('div');
        footerContainer.className = 'p-6 flex justify-end items-center';
        footer.append(footerContainer);
        this.el.append(footer);

        this._actionTitle = document.createElement('div');
        this._actionTitle.className = 'flex flex-1';
        footerContainer.append(this._actionTitle);

        if (this._cancel) {
            this.cancelBtn = new MButton(
                this._cancel.label || l[1597],
                null,
                () => {
                    this.triggerCancelAction();
                },
                (this._cancel.classes) ? this._ok.classes.join(' ') : 'mega-button'
            );

            footerContainer.append(this.cancelBtn.el);
        }

        if (this._ok) {
            this.okBtn = new MButton(
                this._ok.label || l[1596],
                null,
                () => {
                    let result = true;

                    if (typeof this._ok === 'function') {
                        result = this._ok();
                    }
                    else if (this._ok.callback) {
                        result = this._ok.callback();
                    }

                    if (result !== false) {
                        this.hide();
                    }
                },
                this._ok.classes ? this._ok.classes.join(' ') : 'mega-button positive'
            );

            footerContainer.append(this.okBtn.el);

            this.disposeEnterHit = MComponent.listen(document, 'keyup', (evt) => {
                if (this.okBtn.el.disabled) {
                    return;
                }

                if (evt.key === 'Enter') {
                    this.okBtn.el.click();
                    return false;
                }
                else if (evt.key === 'Escape') {
                    this.hide();
                }
            });
        }
    }
}
