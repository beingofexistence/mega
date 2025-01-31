import React from 'react';
import { MegaRenderMixin, timing } from '../../mixins';
import utils, { OFlowParsedHTML, ParsedHTML } from '../../../ui/utils.jsx';
import { Avatar, ContactAwareName } from '../contacts.jsx';

export default class ConversationsListItem extends MegaRenderMixin {
    isLoading() {
        const mb = this.props.chatRoom.messagesBuff;

        if (mb.haveMessages) {
            return false;
        }

        return mb.messagesHistoryIsLoading() || mb.joined === false && mb.isDecrypting;
    }

    specShouldComponentUpdate() {
        return !this.loadingShown;
    }

    componentWillMount() {
        this.chatRoomChangeListener = SoonFc(200 + Math.random() * 400 | 0, () => {
            if (d > 2) {
                console.debug('%s: loading:%s', this.getReactId(), this.loadingShown, this.isLoading(), [this]);
            }
            this.safeForceUpdate();
        });
        this.props.chatRoom.rebind('onUnreadCountUpdate.conversationsListItem', () => {
            delete this.lastMessageId;
            this.safeForceUpdate();
        });
        this.props.chatRoom.addChangeListener(this.chatRoomChangeListener);
    }

    componentWillUnmount() {
        super.componentWillUnmount();
        this.props.chatRoom.removeChangeListener(this.chatRoomChangeListener);
        this.props.chatRoom.unbind('onUnreadCountUpdate.conversationsListItem');
    }

    componentDidMount() {
        super.componentDidMount();
        this.eventuallyScrollTo();
    }

    componentDidUpdate() {
        super.componentDidUpdate();

        this.eventuallyScrollTo();
    }

    @utils.SoonFcWrap(40, true)
    eventuallyScrollTo() {
        const chatRoom = this.props.chatRoom || false;

        if (chatRoom._scrollToOnUpdate) {

            if (chatRoom.isCurrentlyActive) {
                chatRoom.scrollToChat();
            }
            else {
                chatRoom._scrollToOnUpdate = false;
            }
        }
    }

    getConversationTimestamp() {
        const { chatRoom } = this.props;
        if (chatRoom) {
            const lastMessage = chatRoom.messagesBuff.getLatestTextMessage();
            const timestamp = lastMessage && lastMessage.delay || chatRoom.ctime;
            return todayOrYesterday(timestamp * 1000) ? getTimeMarker(timestamp) : time2date(timestamp, 17);
        }
        return null;
    }

    @timing(0.7, 8)
    render() {
        var classString = "";
        var chatRoom = this.props.chatRoom;
        if (!chatRoom || !chatRoom.chatId) {
            return null;
        }

        var roomId = chatRoom.chatId;

        // selected
        if (chatRoom.isCurrentlyActive) {
            classString += " active";
        }

        var nameClassString = "user-card-name conversation-name selectable-txt";

        var contactId;
        var presenceClass;
        var id;
        let contact;

        if (chatRoom.type === "private") {
            const handle = chatRoom.getParticipantsExceptMe()[0];
            if (!handle || !(handle in M.u)) {
                return null;
            }
            contact = M.u[handle];
            id = 'conversation_' + htmlentities(contact.u);

            presenceClass = chatRoom.megaChat.userPresenceToCssClass(
                contact.presence
            );
        }
        else if (chatRoom.type === "group") {
            contactId = roomId;
            id = 'conversation_' + contactId;
            presenceClass = 'group';
            classString += ' groupchat';
        }
        else if (chatRoom.type === "public") {
            contactId = roomId;
            id = 'conversation_' + contactId;
            presenceClass = 'group';
            classString += ' groupchat public';
        }
        else {
            return "unknown room type: " + chatRoom.roomId;
        }
        this.loadingShown = this.isLoading();

        var unreadCount = chatRoom.messagesBuff.getUnreadCount();
        var isUnread = false;

        var notificationItems = [];
        if (chatRoom.havePendingCall() && chatRoom.state !== ChatRoom.STATE.LEFT) {
            notificationItems.push(<i
                className={"tiny-icon " + (chatRoom.isCurrentlyActive ? "blue" : "white") + "-handset"}
                key="callIcon"/>);
        }
        if (unreadCount > 0) {
            notificationItems.push(
                <span key="unreadCounter">
                    {unreadCount > 9 ? "9+" : unreadCount}
                </span>
            );
            isUnread = true;
        }


        var lastMessageDiv = null;
        const showHideMsg  = mega.config.get('showHideChat');

        var lastMessage = showHideMsg ? '' : chatRoom.messagesBuff.getLatestTextMessage();
        var lastMsgDivClasses;

        if (lastMessage && lastMessage.renderableSummary && this.lastMessageId === lastMessage.messageId) {
            lastMsgDivClasses = this._lastMsgDivClassesCache;
            lastMessageDiv = this._lastMessageDivCache;
            lastMsgDivClasses += (isUnread ? " unread" : "");
            if (chatRoom.havePendingCall() || chatRoom.haveActiveCall()) {
                lastMsgDivClasses += " call";
                classString += " call-exists";
            }
        }
        else if (lastMessage) {
            lastMsgDivClasses = "conversation-message" + (isUnread ? " unread" : "");
            // safe some CPU cycles...
            var renderableSummary = lastMessage.renderableSummary || chatRoom.messagesBuff.getRenderableSummary(
                lastMessage
            );
            lastMessage.renderableSummary = renderableSummary;

            if (chatRoom.havePendingCall() || chatRoom.haveActiveCall()) {
                lastMsgDivClasses += " call";
                classString += " call-exists";
            }
            lastMessageDiv =
                <div className={lastMsgDivClasses}>
                    <ParsedHTML>
                        {renderableSummary}
                    </ParsedHTML>
                </div>;
            const voiceClipType = Message.MANAGEMENT_MESSAGE_TYPES.VOICE_CLIP;

            if (
                lastMessage.textContents &&
                lastMessage.textContents[1] === voiceClipType &&
                lastMessage.getAttachmentMeta()[0]
            ) {
                const playTime = secondsToTimeShort(lastMessage.getAttachmentMeta()[0].playtime);
                lastMessageDiv = (
                    <div className={lastMsgDivClasses}>
                        <i className="sprite-fm-mono icon-audio-filled voice-message-icon" />
                        {playTime}
                    </div>
                );
            }

            if (lastMessage.metaType && lastMessage.metaType === Message.MESSAGE_META_TYPE.GEOLOCATION) {
                lastMessageDiv =
                    <div className={lastMsgDivClasses}>
                        <i className="sprite-fm-mono icon-location geolocation-icon" />
                        {l[20789]}
                    </div>;
            }
        }
        else {
            lastMsgDivClasses = "conversation-message";

            /**
             * Show "Loading" until:
             * 1. I'd fetched chats from the API.
             * 2. I'm retrieving history at the moment.
             * 3. I'd connected to chatd and joined the room.
             */
            lastMessageDiv = showHideMsg
                ? '' :
                <div className={lastMsgDivClasses}>
                    {this.loadingShown ? l[7006] : l[8000]}
                </div>;
        }

        this.lastMessageId = lastMessage && lastMessage.messageId;
        this._lastMsgDivClassesCache = lastMsgDivClasses
            .replace(" call-exists", "")
            .replace(" unread", "");
        this._lastMessageDivCache = lastMessageDiv;


        if (chatRoom.type !== "public") {
            nameClassString += " privateChat";
        }
        let roomTitle = <OFlowParsedHTML>{megaChat.html(chatRoom.getRoomTitle())}</OFlowParsedHTML>;
        if (chatRoom.type === "private") {
            roomTitle =
                <ContactAwareName contact={this.props.contact}>
                    <div className="user-card-wrapper">
                        <OFlowParsedHTML>{megaChat.html(chatRoom.getRoomTitle())}</OFlowParsedHTML>
                    </div>
                </ContactAwareName>;
        }
        nameClassString += chatRoom.type === "private" || chatRoom.type === "group" ? ' badge-pad' : '';

        return (
            <li
                id={id}
                className={classString}
                data-room-id={roomId}
                data-jid={contactId}
                onClick={ev => this.props.onConversationClick(ev)}>
                <div className="conversation-avatar">
                    {(chatRoom.type === 'group' || chatRoom.type === 'public') &&
                        <div
                            className={`
                                chat-topic-icon
                                ${chatRoom.isMeeting ? 'meeting-icon' : ''}
                            `}>
                            <i
                                className={
                                    chatRoom.isMeeting ?
                                        'sprite-fm-mono icon-video-call-filled' :
                                        'sprite-fm-uni icon-chat-group'
                                }
                            />
                        </div>
                    }
                    {chatRoom.type === 'private' && contact && <Avatar contact={contact} />}
                </div>
                <div className="conversation-data">
                    <div className="conversation-data-top">
                        <div className={`conversation-data-name ${nameClassString}`}>
                            {roomTitle}
                        </div>
                        <div className="conversation-data-badges">
                            {chatRoom.type === "private" && <span className={`user-card-presence ${presenceClass}`} />}
                            {(chatRoom.type === "group" || chatRoom.type === "private") &&
                                <i className="sprite-fm-uni icon-ekr-key simpletip" data-simpletip={l[20935]} />}
                        </div>
                    </div>
                    <div className="clear" />
                    <div className="conversation-message-info">
                        {lastMessageDiv}
                    </div>
                </div>
                <div className='date-time-wrapper'>
                    <div className="date-time">{this.getConversationTimestamp()}</div>
                    {notificationItems.length > 0 ?
                            <div className="unread-messages-container">
                                <div className={`unread-messages items-${notificationItems.length}`}>
                                    {notificationItems}
                                </div>
                            </div> : null}
                </div>
            </li>
        );
    }
}
