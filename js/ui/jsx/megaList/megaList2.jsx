import React from 'react';
import {PerfectScrollbar} from "../../perfectScrollbar.jsx";
import {MegaRenderMixin, SoonFcWrap} from "../../../chat/mixins";

/**
 * Required props:
 * - listAdapter (Table/Grid)
 * - nodeAdapter custom component that would get rendered when needed and passed "id" of the target element
 */
export class MegaList2 extends MegaRenderMixin {
    _calculated = false;
    _firstRender = true;
    customIsEventuallyVisible = true;
    requiresUpdateOnResize = true;
    adapterChangedDoRepaint = false;
    constructor(props) {
        super(props);

        assert(props.listAdapter, 'missing `listAdapter` for MegaList2');
        assert(props.nodeAdapter, 'missing `nodeAdapter` for MegaList2');
        assert(props.entries, 'missing `entries` for MegaList2');

        this.options = {
            extraRows: 4,
            batchPages: 0,
            perfectScrollOptions: {
                'handlers': ['click-rail', 'drag-scrollbar', 'wheel', 'touch'],
                'minScrollbarLength': 20
            }
        };

        this.onPsUserScroll = this.onPsUserScroll.bind(this);

        this.thumbsThatRequireLoading = [];
        this.requestThumbnailCb = this.requestThumbnailCb.bind(this);
    }
    specShouldComponentUpdate(nextProps) {
        let invalidate = false;
        if (
            nextProps.listAdapter.prototype.constructor.name !== this.props.listAdapter.prototype.constructor.name ||
            nextProps.entries !== this.props.entries ||
            nextProps.viewMode !== this.props.viewMode
        ) {
            invalidate = true;
        }

        if (
            nextProps.sortBy !== this.props.sortBy ||
            nextProps.currentlyViewedEntry !== this.props.currentlyViewedEntry
        ) {
            invalidate = true;
            this.ps.scrollToY(0);
        }

        if (invalidate) {
            this._calculated = false;
            this.adapterChangedDoRepaint = true;
            return true;
        }
        // don't alter rendering decision behaviour, just cleanup local state in case of adapter change
        return null;
    }
    _recalculate() {
        if (this._calculated) {
            return this._calculated;
        }
        var calculated = this._calculated = Object.create(null);

        lazy(calculated, 'scrollWidth', () => {
            return this.ps.getClientWidth();
        });

        lazy(calculated, 'scrollHeight', () => {
            return this.ps.getClientHeight();
        });

        lazy(calculated, 'itemWidth', () => {
            if (this.props.listAdapter.itemWidth === false) {
                return calculated.scrollWidth;
            }
            return this.props.listAdapter.itemWidth;
        });
        lazy(calculated, 'itemHeight', () => {
            return this.props.itemHeight || this.props.listAdapter.itemHeight;
        });

        lazy(calculated, 'contentWidth', () => {
            var contentWidth = this.ps.getContentWidth();
            if (contentWidth) {
                return contentWidth;
            }
            return calculated.itemWidth;
        });

        lazy(calculated, 'itemsPerRow', () => {
            if (this.props.listAdapter.itemsPerRow) {
                // save some CPU cycles
                return this.props.listAdapter.itemsPerRow;
            }
            return Math.max(1, Math.floor(calculated.contentWidth / calculated.itemWidth));
        });

        lazy(calculated, 'contentHeight', () => {
            return Math.ceil(this.props.entries.length / calculated.itemsPerRow) * calculated.itemHeight;
        });

        lazy(calculated, 'scrollLeft', () => {
            return this.ps.getScrollPositionX();
        });
        lazy(calculated, 'scrollTop', () => {
            if (this.adapterChangedDoRepaint) {
                // fake scrollTop 0, until a repaint is done on the PS
                return 0;
            }
            return this.ps.getScrollPositionY();
        });
        lazy(calculated, 'scrolledPercentX', () => {
            return 100 / calculated.scrollWidth * calculated.scrollLeft;
        });
        lazy(calculated, 'scrolledPercentY', () => {
            return 100 / calculated.scrollHeight * calculated.scrollTop;
        });
        lazy(calculated, 'isAtTop', () => {
            return calculated.scrollTop === 0;
        });
        lazy(calculated, 'isAtBottom', () => {
            return calculated.scrollTop === calculated.scrollHeight;
        });
        lazy(calculated, 'itemsPerPage', () => {
            return Math.ceil(calculated.scrollHeight / calculated.itemHeight) * calculated.itemsPerRow;
        });

        lazy(calculated, 'visibleFirstItemNum', () => {
            var value = 0;

            value = Math.floor(Math.floor(
                calculated.scrollTop / calculated.itemHeight
            ) * calculated.itemsPerRow);

            if (value > 0) {
                value = Math.max(0, value - this.options.extraRows * calculated.itemsPerRow);
            }

            return value;
        });

        lazy(calculated, 'visibleLastItemNum', () => {
            var value = Math.min(
                this.props.entries.length,
                Math.ceil(
                    Math.ceil(calculated.scrollTop / calculated.itemHeight) *
                    calculated.itemsPerRow + calculated.itemsPerPage
                )
            );

            if (value < this.props.entries.length) {
                value = Math.min(this.props.entries.length, value + this.options.extraRows * calculated.itemsPerRow);
            }

            return value;
        });

        if (this.options.batchPages > 0) {
            var perPage = calculated.itemsPerPage;

            var visibleF = calculated.visibleFirstItemNum;
            calculated.visibleFirstItemNum = Math.max(
                0,
                ((visibleF - visibleF % perPage) / perPage - 1 - this.options.batchPages) * perPage
            );

            var visibleL = calculated.visibleLastItemNum;
            calculated.visibleLastItemNum = Math.min(
                this.props.entries.length,
                ((visibleL - visibleL % perPage) / perPage + 1 + this.options.batchPages) * perPage
            );
        }
    }
    _contentUpdated() {
        this._calculated = false;
        this._recalculate();

        if (this.listContent && this._lastContentHeight !== this._calculated.contentHeight) {
            this._lastContentHeight = this._calculated.contentHeight;
            this.listContent.style.height = this._calculated.contentHeight + "px";
        }

        // scrolled out of the viewport if the last item in the list was removed? scroll back a little bit...
        if (
            this.ps &&
            this._calculated.scrollHeight + this._calculated.scrollTop > this._calculated.contentHeight
        ) {
            this.ps.scrollToY(
                this._calculated.contentHeight - this._calculated.scrollHeight
            );
        }


        // notify listAdapterInstance if needed/supported
        if (this.listAdapterInstance && this.listAdapterInstance.onContentUpdated) {
            this.listAdapterInstance.onContentUpdated();
        }
    }
    _getCalcsThatTriggerChange() {
        return [
            this.props.entries.length,
            this._calculated.scrollHeight,
            this._calculated.itemWidth,
            this._calculated.itemHeight,
            this._calculated.contentWidth,
            this._calculated.itemsPerRow,
            this._calculated.contentHeight,
            this._calculated.visibleFirstItemNum,
            this._calculated.visibleLastItemNum
        ];
    }
    indexOfEntry(nodeHandle, prop) {
        prop = prop || 'h';

        for (let i = 0; i < this.props.entries.length; i++) {
            let entry = this.props.entries[i];
            if (entry[prop] === nodeHandle) {
                return i;
            }
        }
        return -1;
    }
    scrollToItem(nodeHandle) {
        var elementIndex = this.indexOfEntry(nodeHandle);
        if (elementIndex === -1) {
            return false;
        }

        var shouldScroll = false;
        var itemOffsetTop = Math.floor(elementIndex / this._calculated.itemsPerRow) * this._calculated.itemHeight;
        var itemOffsetTopPlusHeight = itemOffsetTop + this._calculated.itemHeight;


        if (
            // check if the item is above the visible viewport
            itemOffsetTop < this._calculated.scrollTop ||
            // check if the item is below the visible viewport
            itemOffsetTopPlusHeight > this._calculated.scrollTop + this._calculated.scrollHeight
        ) {
            shouldScroll = true;
        }

        // have to scroll
        if (shouldScroll) {
            this.ps.scrollToY(itemOffsetTop);
            onIdle(() => {
                this.safeForceUpdate();
            });

            return true;
        }

        return false;
    }
    @SoonFcWrap(30, true)
    onPsUserScroll() {
        if (!this.isMounted()) {
            // can happen, because of the SoonFc
            return;
        }
        let oldCalc = JSON.stringify(this._getCalcsThatTriggerChange());
        this._contentUpdated();
        let newCalc = JSON.stringify(this._getCalcsThatTriggerChange());
        if (oldCalc !== newCalc) {
            this.forceUpdate();
        }
    }
    onResizeDoUpdate() {
        super.onResizeDoUpdate();

        // recalc
        this._contentUpdated();
    }
    componentDidMount() {
        super.componentDidMount();

        this._contentUpdated();
        this.forceUpdate();
    }
    componentDidUpdate() {
        super.componentDidUpdate();

        this._contentUpdated();

        if (this.adapterChangedDoRepaint) {
            this.adapterChangedDoRepaint = false;
            this._calculated = false;
            this._recalculate();
        }

        if (this.thumbsThatRequireLoading.length > 0) {
            fm_thumbnails('standalone', this.thumbsThatRequireLoading);
            this.thumbsThatRequireLoading = [];
        }

        if (this._firstRender && this.ps) {
            this._firstRender = false;
            Ps.update(this.ps.findDOMNode());
        }
    }

    requestThumbnailCb(node, immediate, callback) {
        if (thumbnails[node.h]) {
            return;
        }
        if (!node.imgId) {
            node.imgId = "chat_" + node.h;
        }
        this.thumbsThatRequireLoading.push(node);
        if (immediate) {
            fm_thumbnails('standalone', this.thumbsThatRequireLoading, callback);
            this.thumbsThatRequireLoading = [];
        }
    }
    render() {
        if (this.isMounted() && !this._calculated) {
            this._recalculate();
        }
        this.thumbsThatRequireLoading = [];

        let {
            listAdapter,
            listAdapterOpts,
            entries,
            nodeAdapterProps,
            viewMode,
            header,
            onContextMenu
        } = this.props;

        let className = listAdapter.containerClassName + " megaList megaList2";

        var first = this._calculated.visibleFirstItemNum;
        var last = this._calculated.visibleLastItemNum;

        let nodes = [];
        for (var i = first; i < last; i++) {
            let node = entries[i];

            nodes.push(
                <this.props.nodeAdapter
                    key={i + "_" + node[this.props.keyProp]}
                    h={node[this.props.keyProp]}
                    index={i}
                    megaList={this}
                    listAdapter={listAdapter}
                    node={node}
                    calculated={this._calculated}
                    listAdapterOpts={listAdapterOpts}
                    onContextMenu={onContextMenu}
                    selected={this.props.selected ? this.props.selected.indexOf(node[this.props.keyProp]) > -1 : false}
                    highlighted={this.props.highlighted ?
                        this.props.highlighted.indexOf(node[this.props.keyProp]) > -1 : false
                    }
                    requestThumbnailCb={this.requestThumbnailCb}
                    keyProp={this.props.keyProp || 'h'}
                    {...nodeAdapterProps}
                />
            );
        }

        let listAdapterName = listAdapter.prototype.constructor.name;

        return <>
            {header}
            <PerfectScrollbar
                key={"ps_" + listAdapterName + "_" + viewMode}
                options={this.options.perfectScrollOptions}
                onUserScroll={this.onPsUserScroll}
                className={className}
                style={{
                    'position': 'relative'
                }}
                ref={(instance) => {
                    this.ps = instance;
                }}>
                <this.props.listAdapter
                    containerClassName={this.props.containerClassName}
                    key={"ps_" + listAdapterName + "_" + this.props.viewMode + "_la"}
                    ref={(listAdapterInstance) => {
                        this.listAdapterInstance = listAdapterInstance;
                    }}
                    listContentRef={(listContent) => {
                        this.listContent = listContent;
                    }}
                    megaList={this}
                    calculated={this._calculated}
                    {...listAdapterOpts}
                >
                    {nodes}
                </this.props.listAdapter>
            </PerfectScrollbar>
        </>;
    }
}
