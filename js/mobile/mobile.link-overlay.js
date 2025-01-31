/**
 * Code to trigger the mobile file manager's export/copy and remove link overlay and related behaviour
 */
mobile.linkOverlay = {

    /** jQuery selector for the overlay */
    $overlay: null,

    /**
     * Initialise the overlay
     * @param {String} nodeHandle A public or regular node handle
     */
    show: function(nodeHandle) {

        'use strict';

        // Store the selector as it is re-used
        this.$overlay = $('#mobile-ui-copy-link');

        // Lets make sure remove megadrop class from this overlay
        this.$overlay.removeClass('megadrop');

        // Get initial overlay details
        var node = M.d[nodeHandle];
        var fileName = node.name;
        var fileSizeBytes = node.s || node.tb;
        var fileSize = numOfBytes(fileSizeBytes);
        var fileSizeFormatted = fileSize.size + ' ' + fileSize.unit;
        var fileIconName = fileIcon(node);
        var fileIconPath = mobile.imagePath + fileIconName + '.png';
        var self = this;

        // Set file name, size and image
        this.$overlay.find('.filename').text(fileName);
        this.$overlay.find('.filesize').text(fileSizeFormatted);
        this.$overlay.find('.filetype-img').attr('src', fileIconPath);

        // By default show the remove and copy buttons as disabled
        this.$overlay.find('.copy').addClass('disabled');
        this.$overlay.find('.remove').addClass('disabled');
        $('#mobile-public-link', this.$overlay).val('');

        mobile.initOverlayPopstateHandler(this.$overlay);

        var tmpFn = function() {

            // If a link already exists for this, show the link and copy/remove buttons
            if (node.ph || folderlink) {
                this.showPublicLinkAndEnableButtons(nodeHandle);
            }
            else {

                // Otherwise create the link first then show the link and copy/remove buttons
                var exportLink = new mega.Share.ExportLink({
                    'showExportLinkDialog': false,
                    'updateUI': false,
                    'nodesToProcess': [nodeHandle]
                });
                exportLink.getExportLink();
            }

            // Initialise the buttons
            this.initCopyButton(nodeHandle);
            this.initRemoveButton(nodeHandle);
            this.initCloseButton();

            // Disable scrolling of the file manager in the background to fix a bug on iOS Safari
            $('.mobile.file-manager-block').addClass('disable-scroll');

            // Show the overlay
            this.$overlay.removeClass('hidden').addClass('overlay');
        };

        var mdList = mega.megadrop.isDropExist(nodeHandle);

        if (mdList.length) {

            mega.megadrop.showRemoveWarning(mdList).done(function() {
                mega.megadrop.pufRemove(mdList).done(tmpFn.bind(self));
            });
        }
        else {
            tmpFn.call(this);
        }
    },

    /**
     * Initialise the Copy link button on the overlay
     * @param {String} nodeHandle The node handle for this file
     */
    initCopyButton: function(nodeHandle) {

        'use strict';

        // On Copy Link button click/tap
        this.$overlay.find('.copy').off('tap').on('tap', function() {

            // If the link is created (has a public handle), copy the public link to the clipboard
            if (M.d[nodeHandle].ph || folderlink) {
                mobile.linkOverlay.copyPublicLink(nodeHandle);
            }

            // Prevent default anchor link behaviour
            return false;
        });
    },

    /**
     * Copy the public link to the user's clipboard
     */
    copyPublicLink: function() {

        'use strict';

        try {
            // Select / highlight the text
            document.getElementById('mobile-public-link').select();

            // Copy it to the clipboard
            var success = document.execCommand('copy');

            // If it succeeded, show a toast message at the top of the page (because of the onscreen keyboard)
            if (success) {
                mobile.showToast(l[7677]);    // Link copied
            }
            else {
                // Otherwise tell them to copy manually
                mobile.showToast(l[16348]);
            }
        }
        catch (exception) {

            // If not supported, tell them to copy manually
            mobile.showToast(l[16348]);
        }
    },

    /**
     * Shows the public link in a text area, also enables the copy and remove buttons
     * @param {String} nodeHandle The internal node handle
     */
    showPublicLinkAndEnableButtons: function(nodeHandle) {

        'use strict';

        // Format the public link with key
        var publicUrl = this.formatLink(nodeHandle);

        if (!publicUrl) {
            // Something went wrong...
            msgDialog('warninga', l[17564], l[17565]);
            return false;
        }

        // Cache some selectors
        var $overlay = mobile.linkOverlay.$overlay;
        var $publicLinkTextField = $overlay.find('.public-link');
        var $copyLinkButton = $overlay.find('.copy');
        var $removeLinkButton = $overlay.find('.remove');

        // Reset the height of the textarea from previous viewings, then set the URL into the text field
        $publicLinkTextField.height(0);
        $publicLinkTextField.val(publicUrl);

        // Set a small 100ms timeout to give time for the textarea scroll height to be updated
        setTimeout(function() {

            // Calculate the actual height of the textarea contents and subtract the top and bottom padding (in pixels)
            var height = $publicLinkTextField.prop('scrollHeight') - 24;

            // Set the correct height of the text field
            $publicLinkTextField.height(height);

        }, 100);

        // If not on iOS allow copy link functionality
        if (!is_ios) {
            $copyLinkButton.removeClass('disabled');
        }
        else {
            // If on iOS hide copy link button (iOS doesn't allow copy to clipboard for now)
            $copyLinkButton.addClass('hidden');
            $removeLinkButton.addClass('ios');
        }

        // Enable Remove Link button
        $removeLinkButton.removeClass('disabled');

        // Update the link icon in the file manager view
        mobile.cloud.updateLinkIcon(nodeHandle);
    },

    /**
     * Formats the public link with key
     * @param {String} nodeHandle The internal node handle
     * @returns {String} Returns the URL in format:
     *                   https://mega.nz/#!X4NiADjR!BRqpTTSy-4UvHLz_6sHlpnGS-dS0E_RIVCpGAtjFmZQ
     */
    formatLink: function(nodeHandle) {
        'use strict';

        var node = M.getNodeByHandle(nodeHandle);
        var key = node.k;
        var type = '';

        if (!node.ph && !folderlink) {
            if (d) {
                console.warn('No public handle for node %s', nodeHandle);
            }
            return false;
        }

        var nodeUrlWithPublicHandle;
        var nodeDecryptionKey;
        var fileUrlNodeHandle = '';

        if (folderlink) {
            if (mega.flags.nlfe) {
                nodeUrlWithPublicHandle = getBaseUrl() + '/folder/' + pfid + '#';
                nodeDecryptionKey = pfkey;
                fileUrlNodeHandle = (node.t ? '/folder/' : '/file/') + node.h;
            }
            else {
                nodeUrlWithPublicHandle = getBaseUrl() + '/#F!' + pfid;
                nodeDecryptionKey = '!' + pfkey;
                fileUrlNodeHandle = (node.t ? '!' : '?') + node.h;
            }
        }
        else {
            if (node.t) {
                type = 'F';
                key = u_sharekeys[node.h] && u_sharekeys[node.h][0];
            }

            if (mega.flags.nlfe) {
                type = (type) ? '/folder/' : '/file/';
                nodeUrlWithPublicHandle = getBaseUrl() + type + node.ph + '#';
                nodeDecryptionKey = (key ? a32_to_base64(key) : '');
            }
            else {
                nodeUrlWithPublicHandle = getBaseUrl() + '/#' + type + '!' + node.ph;
                nodeDecryptionKey = key ? '!' + a32_to_base64(key) : '';
            }
        }

        return nodeUrlWithPublicHandle + nodeDecryptionKey + fileUrlNodeHandle;
    },

    /**
     * Initialise the Remove link button
     * @param {String} nodeHandle The node handle for this file
     */
    initRemoveButton: function(nodeHandle) {

        'use strict';
        const removeLink = (e) => {
            if (!e) {
                return;
            }
            // Remove the link
            var exportLink = new mega.Share.ExportLink({
                'showExportLinkDialog': false,
                'updateUI': false,
                'nodesToProcess': [nodeHandle]
            });
            exportLink.removeExportLink();
        };
        const toggleConfig = (toggle) => {
            if (toggle) {
                mega.config.setn('nowarnpl', 1);
            }
            else {
                mega.config.remove('nowarnpl');
            }
        };

        if (folderlink) {
            onIdle(() => $('.remove', this.$overlay).addClass('disabled'));
        }

        // On Remove Link button click/tap
        $('.remove', this.$overlay).rebind('tap', (ev) => {
            if ($(ev.currentTarget).hasClass('disabled')) {
                if (folderlink) {
                    $('.fm-dialog-close', this.$overlay).trigger('tap');
                }
                return false;
            }
            const media = is_video(M.d[nodeHandle]) === 1;
            const mediaRemoveLink = () => {
                msgDialog('confirmation', l[882], l[17824], 0, removeLink);
            };
            if (mega.config.get('nowarnpl')) {
                if (media) {
                    mediaRemoveLink();
                }
                else {
                    removeLink(1);
                }
            }
            else {
                let subtitle = M.d[nodeHandle].t
                    ? mega.icu.format(l.plink_remove_dlg_text_folder, 1)
                    : mega.icu.format(l.plink_remove_dlg_text_file, 1);
                const title = mega.icu.format(l.plink_remove_dlg_title, 1);
                if (media) {
                    subtitle += `<br><br>${l[17824]}`;
                }
                msgDialog('confirmation', '', title, subtitle, removeLink, toggleConfig);
            }

            // Prevent default anchor link behaviour
            return false;
        });
    },

    /**
     * Completes removal of the link by showing a toast message and hiding the Link/Export overlay
     * @param {String} nodeHandle The internal node handle
     */
    completeLinkRemovalProcess: function(nodeHandle) {

        'use strict';

        // Show a toast message, hide the overlay and update the link icon
        mobile.showToast(l[8759]);                                        // Link removed
        if (mobile.linkOverlay.$overlay) {
            mobile.linkOverlay.$overlay.addClass('hidden');
        }
        mobile.cloud.updateLinkIcon(nodeHandle);

        // Re-show the file manager and re-enable scrolling
        $('.mobile.file-manager-block').removeClass('hidden disable-scroll');
    },

    /**
     * Initialises the close button on the overlay
     */
    initCloseButton: function() {

        'use strict';

        var $closeButton = this.$overlay.find('.fm-dialog-close');
        var $closeTextButton = this.$overlay.find('.text-button');
        const callback = e => {

            // This is real touch, just trigger history back to clear history
            if (e.originalEvent) {

                history.back();

                return false;
            }

            // Hide overlay
            mobile.linkOverlay.$overlay.addClass('hidden');

            // Re-show the file manager and re-enable scrolling
            $('.mobile.file-manager-block').removeClass('hidden disable-scroll');

            // Prevent clicking the menu button behind
            return false;
        };

        // Add tap handler
        $closeButton.rebind('tap', callback);
        $closeTextButton.rebind('tap', callback);
    }
};
