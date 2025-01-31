var syncurl;
var nautilusurl;
var syncsel = false;

function renderMacOptions() {
    'use strict';
    const $page = $('.bottom-page.megasync');
    const $macContainer = $('.megaapp-macos', $page);
    const $downloadBtn = $('button.mac-download', $macContainer);
    const $archInputWraps = $('.mac-arch', $macContainer);
    const $archInputs = $('input', $archInputWraps);

    const setRadio = (value, $select) => {
        $archInputWraps.removeClass('radioOn').addClass('radioOff');
        $archInputs.removeClass('radioOn').addClass('radioOff').prop('checked', false);

        if (!$select) {
            $select = $archInputs.filter(`input[value="${value}"]`);
        }

        $select.parent().removeClass('radioOff').addClass('radioOn');
        $select.removeClass('radioOff').addClass('radioOn').prop('checked', true);
    };

    $archInputs.rebind('click', (e) => {
        const $select = $(e.currentTarget);
        setRadio($select.val(), $select);
    });

    $downloadBtn.rebind('click', () => {
        const selectedArch = $('input[name="mac-arch"]:checked', $macContainer).val();
        window.location = megasync.getMegaSyncUrl(selectedArch === 'intel' ? 'mac' : 'mac_silicon');
    });

    $('.nav-buttons-bl a.mac', $page).addClass('active');
    $macContainer.removeClass('hidden');

    // Apple Silicon might also return 'MacIntel'.
    setRadio(navigator.platform.toUpperCase().includes('MACINTEL') ? 'intel' : 'silicon');
}

function renderLinuxOptions(linuxsync, event) {
    var ostxt;
    var $content = event ? $(event.target.closest('.vertical-centered-bl')) : $('.bottom-page.megasync');
    var $linuxContainer = $('.megaapp-linux-box-container', $content);
    syncurl = undefined;
    syncsel = false;

    $content.addClass('linux');
    $linuxContainer.removeClass('hidden');

    $('.architecture-checkbox input', $content).rebind('click', function() {
        var $this = $(this);
        var $radioWrappers = $('.architecture-checkbox', this.closest('.linux-bit-radio'));

        $radioWrappers.removeClass('radioOn').addClass('radioOff');
        $('input', $radioWrappers).removeClass('radioOn').addClass('radioOff')
            .prop('checked', false);

        $this.parent().removeClass('radioOff').addClass('radioOn');
        $this.removeClass('radioOff').addClass('radioOn').prop('checked', true);

        if (syncsel) {
            setTimeout(function() {
                changeLinux(linuxsync, syncsel);
            }, 1);
        }

        return false;
    });
    $('.nav-buttons-bl a.linux', $content).addClass('active');
    $('.megasync .megaapp-linux-default', $content).text(l[7086]);

    var ua = navigator.userAgent.toLowerCase();

    if (ua.indexOf('i686') > -1 || ua.indexOf('i386') > -1 || ua.indexOf('i586') > -1) {
        $content.find('.megaapp-linux .linux32').click();
    }

    loadingDialog.hide();

    megasync.UILinuxDropdown(function($element) {
        changeLinux(linuxsync, $element.data('client-id'));
        return false;
    });
}

/**
 * Reset MEGAsync to default
 */
function resetMegasync() {

    'use strict';

    var $content = $('.bottom-page.megasync');
    var $linuxBlock = $('.megaapp-linux', $content);

    $content.removeClass('linux');
    $('.pages-nav.nav-button', $content).removeClass('active');
    $('.megaapp-macos', $content).addClass('hidden');
    $('.megaapp-linux-box-container', $content).addClass('hidden');
    $('.nav-buttons-bl a.linux', $content).removeClass('active');
    $('.radio-buttons label, .architecture-checkbox', $linuxBlock).removeClass('hidden');
    $('.linux-bit-radio', $linuxBlock).addClass('hidden');
    $('.megaext-dropdown', $linuxBlock).addClass('disabled');
    $('.megaext-header', $linuxBlock).addClass('disabled');
    $('.megaext-info-hover', $linuxBlock).addClass('disabled');
    $('.megaapp-linux-download, .megaext-linux-download', $linuxBlock)
        .addClass('disabled');
    $('.dropdown-input > span', $linuxBlock).text(l[7086]);
}

/**
 * Init MEGAsync functions
 */
function initMegasync() {

    'use strict';

    var $content = $('.bottom-page.megasync');
    var pf = navigator.platform.toUpperCase();

    resetMegasync();

    // Hide windows options as default
    $('.megaapp-windows', $content).addClass('hidden');

    // Preload linux options if on a linux client
    if (pf.indexOf('LINUX') >= 0) {
        const linuxTabBtn = $('.nav-buttons-bl a.linux');
        linuxTabBtn.addClass('active');
        megasync.getLinuxReleases((next) => {
            // check the user hasn't selected a different tab before linux options were fetched
            if (linuxTabBtn.hasClass('active')) {
                renderLinuxOptions(next);
            }
        });
    }
    else if (pf.includes('MAC')) {
        renderMacOptions();
    }

    $('.nav-buttons-bl a', $content).rebind('click', function(ev) {
        var $this = $(this);
        var osData = $this.attr('data-os');

        // Hide windows options as default
        $('.megaapp-windows', $content).addClass('hidden');

        if (osData === 'windows') {
            if (ua.details.is64bit && !ua.details.isARM) {
                // Download app for Windows 64bit
                window.location = megasync.getMegaSyncUrl('windows');
                $('.megaapp-windows-info.64bit', $content).addClass('hidden');
            }
            else {
                // Download app for Windows 32bit
                window.location = megasync.getMegaSyncUrl('windows_x32');
                $('.megaapp-windows-info.32bit', $content).addClass('hidden');
            }

            resetMegasync();
            $('.nav-buttons-bl a.windows', $content).addClass('active');
            $('.megaapp-windows', $content).removeClass('hidden');
        }
        else if (osData === 'mac') {
            resetMegasync();
            renderMacOptions();
        }
        else if (osData === 'linux' && is_mobile) {
            window.open('https://mega.nz/linux/repo/', '_blank');
            resetMegasync();
        }
        else if (osData === 'linux' && $this.hasClass('active')) {
            resetMegasync();
        }
        else {
            loadingDialog.show();
            resetMegasync();
            megasync.getLinuxReleases(linuxsync => {
                renderLinuxOptions(linuxsync, ev);
            });
        }

        return false;
    });

    $('.megaapp-windows-info.32bit a', $content).rebind('click.megasyncWin32', function() {
        window.location = megasync.getMegaSyncUrl('windows_x32');
        return false;
    });

    $('.megaapp-windows-info.64bit a', $content).rebind('click.megasyncWin64', function() {
        window.location = megasync.getMegaSyncUrl('windows');
        return false;
    });

    $('.copy-install-guide-icon', $content)
        .rebind('click', function() {
            var $this = $(this);
            if (copyToClipboard($('.install-guide-copyable', $this.closest('.install-guide-text')).text())) {
                $this.removeClass('active');
                var $icon = $('.copy-line-icon', $this);
                if (!$icon.hasClass('active')) {
                    $icon.addClass('active');
                }
                var $copiedMsg = $('.install-guide-copy-msg', $this.closest('.copy-line'));
                $copiedMsg.removeClass('hidden');
                setTimeout(function() {
                    $icon.removeClass('active');
                    $copiedMsg.addClass('hidden');
                }, 2000);
            }
        });

    registerLinuxDownloadButton($('.megaapp-linux-download, .megaext-linux-download', $content));

    $('.tab-button', $content).rebind('click', function() {
        var $this = $(this);
        var className = $this.attr('data-class');

        if (!$this.hasClass('active')) {
            $('.tab-button, .tab-body, .dark-tab-img', $content).removeClass('active');
            $this.addClass('active');
            $('.' + className, $content).addClass('active');
        }
        return false;
    });
}

function changeLinux(linuxsync, i) {
    'use strict';

    var $content = $('.bottom-page.megasync');

    if (linuxsync[i]) {
        $content.find('.linux-bit-radio').removeClass('hidden');

        var platform = '64';
        if ($('.linux32', $content).parent().hasClass('radioOn')) {
            platform = '32';
        }

        if (linuxsync[i]['32']) {
            $content.find('.linux32').parent().show();
            $content.find('.radio-txt.32').show();
        }
        else {
            $content.find('.linux32').parent().hide();
            $content.find('.radio-txt.32').hide();

            if (platform === '32') {
                platform = '64';
                $('.architecture-checkbox input.linux64', $content).trigger('click');
            }
        }

        if (linuxsync[i]['64']) {
            $('.linux64', $content).parent().show();
            $('.radio-txt.64', $content).show();
        }
        else {
            $('.linux64', $content).parent().hide();
            $('.radio-txt.64', $content).hide();

            if (platform === '64') {
                platform = '32';
                $('.architecture-checkbox input.linux32', $content).trigger('click');
            }
        }

        $content.find('.megaapp-linux-default').text(linuxsync[i].name);

        populateExtensions(i, platform);

        syncurl = megasync.getMegaSyncUrl(linuxsync[i]['name'] + " " + platform);
        $content.find('.megaapp-linux-download')
            .addClass('download')
            .removeClass('disabled')
            .attr('data-link', syncurl);

        $('.install-guide-text span.install-guide').safeHTML(l.desktop_install_guide
            .replace('%1', `<span class="install-guide-copyable">${escapeHTML(linuxsync[i].help_text)}</span>`));

        mBroadcaster.sendMessage('megasync-linux-distro-selected', syncurl);
        syncsel = i;
    }
    else {
        syncurl = false;
        nautilusurl = false;
        $content.find('.nav-buttons-bl a.linux').addClass('active');
        $content.find('.megaapp-linux-default').text(l[7086]);
    }
}

function populateExtensions(distroIndex, platform) {
    'use strict';

    var $content = $('.bottom-page.megasync');

    $content.find('.megaext-linux-download')
        .removeClass('download').addClass('disabled')
        .attr('data-link', null);

    megasync.UIExtensionsDropdown(distroIndex, platform, function(extension) {
        $content.find('.megaext-linux-download')
            .removeClass('disabled').addClass('download')
            .attr('data-link', extension.url);
        return false;
    });
}
