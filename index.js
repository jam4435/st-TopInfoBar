const {
    eventSource,
    event_types,
    getCurrentChatId,
    renameChat,
    getRequestHeaders,
    openGroupChat,
    openCharacterChat,
    executeSlashCommandsWithOptions,
    Popup,
} = SillyTavern.getContext();
import { addJQueryHighlight } from './jquery-highlight.js';
import { getGroupPastChats } from '../../../group-chats.js';
import { getPastCharacterChats, animation_duration, animation_easing, getGeneratingApi } from '../../../../script.js';
import { debounce, timestampToMoment, sortMoments, uuidv4, waitUntilCondition } from '../../../utils.js';
import { debounce_timeout } from '../../../constants.js';
import { t } from '../../../i18n.js';

const movingDivs = /** @type {HTMLDivElement} */ (document.getElementById('movingDivs'));
const sheld = /** @type {HTMLDivElement} */ (document.getElementById('sheld'));
const chat = /** @type {HTMLDivElement} */ (document.getElementById('chat'));
const draggableTemplate = /** @type {HTMLTemplateElement} */ (document.getElementById('generic_draggable_template'));
const apiBlock = /** @type {HTMLDivElement} */ (document.getElementById('rm_api_block'));

const topBar = document.createElement('div');
const chatName = document.createElement('select');
const searchInput = document.createElement('input');
const connectionProfiles = document.createElement('div');
const connectionProfilesStatus = document.createElement('div');
const connectionProfilesSelect = document.createElement('select');
const connectionProfilesIcon = document.createElement('img');

// State variables for message navigation and editing
let currentMessageIndex = -1;
let currentlyEditingMessage = null;
let editStateObserver = null;

let isChatInOperationMode = false;

const outOfChatIcons = [
    {
        id: 'extensionTopBarToggleSidebar',
        icon: 'fa-fw fa-solid fa-box-archive',
        position: 'left',
        title: t`Toggle sidebar`,
        onClick: onToggleSidebarClick,
    },
    {
        id: 'extensionTopBarToggleConnectionProfiles',
        icon: 'fa-fw fa-solid fa-plug',
        position: 'left',
        title: t`Show connection profiles`,
        isTemporaryAllowed: true,
        onClick: onToggleConnectionProfilesClick,
    },
    {
        id: 'extensionTopBarConfirmEdit',
        icon: 'fa-fw fa-solid fa-check',
        position: 'right',
        title: t`Confirm edit`,
        onClick: onConfirmEditClick,
        isHidden: true,
    },
    {
        id: 'extensionTopBarCancelEdit',
        icon: 'fa-fw fa-solid fa-xmark',
        position: 'right',
        title: t`Cancel edit`,
        onClick: onCancelEditClick,
        isHidden: true,
    },
    {
        id: 'extensionTopBarDeleteEdited',
        icon: 'fa-fw fa-solid fa-trash-can',
        position: 'right',
        title: t`Delete this message`,
        onClick: onDeleteEditedClick,
        isHidden: true,
    },
    {
        id: 'extensionTopBarChatManager',
        icon: 'fa-fw fa-solid fa-address-book',
        position: 'right',
        title: t`View chat files`,
        isTemporaryAllowed: true,
        onClick: onChatManagerClick,
    },
    {
        id: 'extensionTopBarNewChat',
        icon: 'fa-fw fa-solid fa-comments',
        position: 'right',
        title: t`New chat`,
        isTemporaryAllowed: true,
        onClick: onNewChatClick,
    },
    {
        id: 'extensionTopBarRenameChat',
        icon: 'fa-fw fa-solid fa-edit',
        position: 'right',
        title: t`Rename chat`,
        onClick: onRenameChatClick,
    },
    {
        id: 'extensionTopBarDeleteChat',
        icon: 'fa-fw fa-solid fa-trash',
        position: 'right',
        title: t`Delete chat`,
        onClick: async () => {
            const confirm = await Popup.show.confirm(t`Are you sure?`);
            if (confirm) {
                await executeSlashCommandsWithOptions('/delchat');
            }
        },
    },
    {
        id: 'extensionTopBarCloseChat',
        icon: 'fa-fw fa-solid fa-times',
        position: 'right',
        title: t`Close chat`,
        isTemporaryAllowed: true,
        onClick: onCloseChatClick,
    },
];

const inChatIcons = [
    {
        id: 'extensionTopBarNavUp',
        icon: 'fa-fw fa-solid fa-arrow-up',
        position: 'right',
        title: t`Scroll to previous reply`,
        onClick: () => navigateReplies(-1),
    },
    {
        id: 'extensionTopBarNavDown',
        icon: 'fa-fw fa-solid fa-arrow-down',
        position: 'right',
        title: t`Scroll to next reply`,
        onClick: () => navigateReplies(1),
    },
    {
        id: 'extensionTopBarEditLastReply',
        icon: 'fa-fw fa-solid fa-pen-to-square',
        position: 'right',
        title: t`Edit selected/last reply`,
        onClick: onEditLastReplyClick,
    },
    {
        id: 'extensionTopBarDeleteLastReply',
        icon: 'fa-fw fa-solid fa-trash-can',
        position: 'right',
        title: t`Delete selected/last reply`,
        onClick: onDeleteLastReplyClick,
    },
];

const icons = [
    {
        id: 'extensionTopBarSettings',
        icon: 'fa-fw fa-solid fa-cog',
        position: 'right',
        title: t`Toggle mode`,
        onClick: toggleMode,
    },
    ...outOfChatIcons,
    ...inChatIcons,
];


function toggleMode() {
    isChatInOperationMode = !isChatInOperationMode;
    updateTopBar();
}

function updateTopBar() {
    const outOfChatIds = outOfChatIcons.map(it => it.id);
    const inChatIds = inChatIcons.map(it => it.id);
    const query = searchInput.value.trim();

    if (isChatInOperationMode) {
        outOfChatIds.forEach(id => document.getElementById(id)?.classList.add('displayNone'));
        inChatIds.forEach(id => document.getElementById(id)?.classList.remove('displayNone'));
        searchInput.placeholder = t`Search in chat...`;
        searchChatsDebounced(''); // Clear chat list search
        searchInChatDebounced(query);
    } else {
        outOfChatIds.forEach(id => document.getElementById(id)?.classList.remove('displayNone'));
        inChatIds.forEach(id => document.getElementById(id)?.classList.add('displayNone'));
        searchInput.placeholder = t`Search chats...`;
        searchInChatDebounced(''); // Clear message highlight
        searchChatsDebounced(query);
    }
    populateSideBar();
}

// Functions for edit mode
function toggleEditButtons(isEditing) {
    const normalButtons = [
        'extensionTopBarToggleSidebar',
        'extensionTopBarToggleConnectionProfiles',
        'extensionTopBarNavUp',
        'extensionTopBarNavDown',
        'extensionTopBarEditLastReply',
        'extensionTopBarDeleteLastReply',
        'extensionTopBarChatManager',
        'extensionTopBarNewChat',
        'extensionTopBarRenameChat',
        'extensionTopBarDeleteChat',
        'extensionTopBarCloseChat',
    ];
    const editButtons = ['extensionTopBarConfirmEdit', 'extensionTopBarCancelEdit', 'extensionTopBarDeleteEdited'];

    if (isEditing) {
        normalButtons.forEach(id => document.getElementById(id)?.classList.add('displayNone'));
        editButtons.forEach(id => document.getElementById(id)?.classList.remove('displayNone'));
    } else {
        normalButtons.forEach(id => document.getElementById(id)?.classList.remove('displayNone'));
        editButtons.forEach(id => document.getElementById(id)?.classList.add('displayNone'));
    }
}

function cleanupEditState() {
    if (editStateObserver) {
        editStateObserver.disconnect();
        editStateObserver = null;
    }
    currentlyEditingMessage = null;
    toggleEditButtons(false);
}

function onConfirmEditClick() {
    if (!currentlyEditingMessage) return;
    const confirmButton = currentlyEditingMessage.querySelector('.mes_edit_buttons .fa-check');
    if (confirmButton) {
        confirmButton.click();
    }
    cleanupEditState();
}

function onCancelEditClick() {
    if (!currentlyEditingMessage) return;
    const cancelButton = currentlyEditingMessage.querySelector('.mes_edit_buttons .fa-xmark');
    if (cancelButton) {
        cancelButton.click();
    }
    cleanupEditState();
}

function onDeleteEditedClick() {
    if (!currentlyEditingMessage) return;
    const deleteButton = currentlyEditingMessage.querySelector('.mes_edit_buttons .fa-trash-can');
    if (deleteButton) {
        deleteButton.click();
    }
    cleanupEditState();
}

// Functions for selective message operations
async function onDeleteLastReplyClick() {
    const chatContainer = document.getElementById('chat');
    const navMessages = Array.from(chatContainer.querySelectorAll('.mes:not([is_system="true"])'));
    const aiMessages = Array.from(chatContainer.querySelectorAll('.mes:not([is_user="true"]):not([is_system="true"])'));

    if (aiMessages.length === 0 && (currentMessageIndex === -1 || !navMessages[currentMessageIndex])) {
        executeSlashCommandsWithOptions(`/echo ${t`No reply found to delete.`}`);
        return;
    }

    let messageToDelete;
    if (currentMessageIndex !== -1 && navMessages[currentMessageIndex]) {
        messageToDelete = navMessages[currentMessageIndex];
    } else {
        messageToDelete = aiMessages[aiMessages.length - 1];
    }

    const mesId = messageToDelete.getAttribute('mesid');
    if (!mesId) {
        executeSlashCommandsWithOptions(`/echo ${t`Selected message cannot be deleted.`}`);
        return;
    }

    const confirm = await Popup.show.confirm(t`Are you sure you want to delete the selected reply?`);
    if (confirm) {
        await executeSlashCommandsWithOptions(`/del ${mesId}`);
        currentMessageIndex = -1; // Reset navigation
    }
}

async function onEditLastReplyClick() {
    if (currentlyEditingMessage) {
        onCancelEditClick();
        return;
    }

    const chatContainer = document.getElementById('chat');
    const navMessages = Array.from(chatContainer.querySelectorAll('.mes:not([is_system="true"])'));
    const aiMessages = Array.from(chatContainer.querySelectorAll('.mes:not([is_user="true"]):not([is_system="true"])'));

    if (aiMessages.length === 0) {
        executeSlashCommandsWithOptions(`/echo ${t`No AI reply found to edit.`}`);
        return;
    }

    let messageToEdit;
    if (currentMessageIndex !== -1 && navMessages[currentMessageIndex]) {
        messageToEdit = navMessages[currentMessageIndex];
    } else {
        messageToEdit = aiMessages[aiMessages.length - 1];
    }

    const editButton = messageToEdit.querySelector('.mes_button.mes_edit.fa-pencil');

    if (editButton) {
        editButton.click();

        let found = false;
        await waitUntilCondition(() => {
            if (messageToEdit.querySelector('.mes_edit_buttons')) {
                found = true;
                return true; // Stop waiting
            }
            return false; // Continue waiting
        }, 2000);

        if (found) {
            currentlyEditingMessage = messageToEdit;
            toggleEditButtons(true);

            editStateObserver = new MutationObserver(() => {
                if (!messageToEdit.querySelector('.mes_edit_buttons')) {
                    cleanupEditState();
                }
            });
            editStateObserver.observe(messageToEdit, { childList: true, subtree: true });
        } else {
            executeSlashCommandsWithOptions(`/echo ${t`Could not enter edit mode.`}`);
        }
    } else {
        executeSlashCommandsWithOptions(`/echo ${t`The selected message cannot be edited.`}`);
    }
}

// Function for message navigation
function navigateReplies(direction) {
    const chatContainer = document.getElementById('chat');
    const messages = Array.from(chatContainer.querySelectorAll('.mes:not([is_system="true"])'));
    if (messages.length === 0) return;

    if (currentMessageIndex === -1) {
        currentMessageIndex = messages.length - 1;
    } else {
        currentMessageIndex += direction;
    }

    currentMessageIndex = Math.max(0, Math.min(messages.length - 1, currentMessageIndex));

    const targetMessage = messages[currentMessageIndex];
    if (targetMessage) {
        targetMessage.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

// Original functions from old file
function onChatManagerClick() {
    document.getElementById('option_select_chat')?.click();
}

function onCloseChatClick() {
    document.getElementById('option_close_chat')?.click();
}

function onNewChatClick() {
    document.getElementById('option_start_new_chat')?.click();
}

async function onRenameChatClick() {
    const currentChatName = getCurrentChatId();

    if (!currentChatName) {
        return;
    }

    const newChatName = await Popup.show.input(t`Enter new chat name`, null, currentChatName);

    if (!newChatName || newChatName === currentChatName) {
        return;
    }

    await renameChat(currentChatName, String(newChatName));
}

function patchSheldIfNeeded() {
    if (!sheld) {
        console.error('Sheld not found.');
        return;
    }
    const computedStyle = getComputedStyle(sheld);
    if (computedStyle.display === 'grid') {
        sheld.classList.add('flexPatch');
    }
}

function setChatName(name) {
    currentMessageIndex = -1; // Reset navigation on chat change
    const isNotInChat = !name;
    chatName.innerHTML = '';
    const selectedOption = document.createElement('option');
    selectedOption.innerText = name || t`No chat selected`;
    selectedOption.selected = true;
    chatName.appendChild(selectedOption);
    chatName.disabled = true;

    updateTopBar();
    icons.forEach(icon => {
        const iconElement = document.getElementById(icon.id);
        if (iconElement && !icon.isTemporaryAllowed) {
            iconElement.classList.toggle('not-in-chat', isNotInChat);
        }
    });

    if (!isNotInChat && typeof openGroupChat === 'function' && typeof openCharacterChat === 'function') {
        setTimeout(async () => {
            const list = [];
            const context = SillyTavern.getContext();
            if (context.groupId) {
                const group = context.groups.find(x => x.id == context.groupId);
                if (group) {
                    list.push(...group.chats);
                }
            }
            else {
                const characterAvatar = context.characters[context.characterId]?.avatar;
                list.push(...await getListOfCharacterChats(characterAvatar));
            }

            if (list.length > 0) {
                chatName.innerHTML = '';
                list.sort((a, b) => a.localeCompare(b)).forEach((x) => {
                    const option = document.createElement('option');
                    option.innerText = x;
                    option.value = x;
                    option.selected = x === name;

                    chatName.appendChild(option);
                });
                chatName.disabled = false;
            }

            await populateSideBar();
        }, 0);
    }

    if (isNotInChat) {
        setTimeout(() => populateSideBar(), 0);
    }
}

async function getListOfCharacterChats(avatar) {
    try {
        const result = await fetch('/api/characters/chats', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ avatar_url: avatar, simple: true }),
        });

        if (!result.ok) {
            return [];
        }

        const data = await result.json();
        return data.map(x => String(x.file_name).replace('.jsonl', ''));
    } catch (error) {
        console.error('Failed to get list of character chats', error);
        return [];
    }
}

async function getChatFiles() {
    const context = SillyTavern.getContext();
    const chatId = getCurrentChatId();

    if (!chatId) {
        return [];
    }

    if (context.groupId) {
        return await getGroupPastChats(context.groupId);
    }

    if (context.characterId !== undefined) {
        return await getPastCharacterChats(context.characterId);
    }

    return [];
}

function searchInChat(query) {
    const options = { element: 'mark', className: 'highlight' };
    const messages = jQuery(chat).find('.mes_text');
    messages.unhighlight(options);
    if (!query) {
        return;
    }
    const splitQuery = query.split(/\s|\b/);
    messages.highlight(splitQuery, options);
}

function searchChats(query) {
    const container = document.getElementById('extensionSideBarContainer');
    if (!container) return;

    const items = container.querySelectorAll('.sideBarItem');
    const lowerCaseQuery = query.toLowerCase();

    items.forEach(item => {
        const chatName = item.querySelector('.chatName')?.textContent.toLowerCase();
        const chatMessage = item.querySelector('.chatMessage')?.textContent.toLowerCase();

        if (!query || (chatName && chatName.includes(lowerCaseQuery)) || (chatMessage && chatMessage.includes(lowerCaseQuery))) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });
}

const searchInChatDebounced = debounce((x) => searchInChat(x), 500);
const searchChatsDebounced = debounce((x) => searchChats(x), 500);
const updateStatusDebounced = debounce(onOnlineStatusChange, 1000);

function addTopBar() {
    chatName.id = 'extensionTopBarChatName';
    topBar.id = 'extensionTopBar';
    searchInput.id = 'extensionTopBarSearchInput';
    searchInput.placeholder = t`Search chats...`;
    searchInput.classList.add('text_pole');
    searchInput.type = 'search';
    searchInput.addEventListener('input', () => {
        const query = searchInput.value.trim();
        if (isChatInOperationMode) {
            searchInChatDebounced(query);
        } else {
            searchChatsDebounced(query);
        }
    });
    topBar.append(chatName, searchInput);
    sheld.insertBefore(topBar, chat);
}

function addIcons() {
    icons.forEach(icon => {
        const iconElement = document.createElement('i');
        iconElement.id = icon.id;
        iconElement.className = icon.icon;
        iconElement.title = icon.title;
        iconElement.tabIndex = 0;
        iconElement.classList.add('right_menu_button');
        if (icon.isHidden) {
            iconElement.classList.add('displayNone');
        }
        iconElement.addEventListener('click', () => {
            if (iconElement.classList.contains('not-in-chat')) {
                return;
            }
            icon.onClick();
        });
        if (icon.position === 'left') {
            topBar.insertBefore(iconElement, chatName);
            return;
        }
        if (icon.position === 'right') {
            topBar.appendChild(iconElement);
            return;
        }
        if (icon.position === 'middle') {
            topBar.insertBefore(iconElement, searchInput);
            return;
        }
        if (icon.id === 'extensionTopBarRenameChat' && typeof renameChat !== 'function') {
            iconElement.classList.add('displayNone');
        }
    });
}

function addSideBar() {
    if (!draggableTemplate) {
        console.warn(t`Draggable template not found. Side bar will not be added.`);
        return;
    }

    const fragment = /** @type {DocumentFragment} */ (draggableTemplate.content.cloneNode(true));
    const draggable = fragment.querySelector('.draggable');
    const closeButton = fragment.querySelector('.dragClose');

    if (!draggable || !closeButton) {
        console.warn(t`Failed to find draggable or close button. Side bar will not be added.`);
        return;
    }

    draggable.id = 'extensionSideBar';
    closeButton.addEventListener('click', onToggleSidebarClick);

    const scrollContainer = document.createElement('div');
    scrollContainer.id = 'extensionSideBarContainer';
    draggable.appendChild(scrollContainer);

    const loaderContainer = document.createElement('div');
    loaderContainer.id = 'extensionSideBarLoader';
    draggable.appendChild(loaderContainer);

    const loaderIcon = document.createElement('i');
    loaderIcon.className = 'fa-2x fa-solid fa-gear fa-spin';
    loaderContainer.appendChild(loaderIcon);

    movingDivs.appendChild(draggable);
}

function addConnectionProfiles() {
    connectionProfiles.id = 'extensionConnectionProfiles';
    connectionProfilesStatus.id = 'extensionConnectionProfilesStatus';
    connectionProfilesSelect.id = 'extensionConnectionProfilesSelect';
    connectionProfilesSelect.title = t`Switch connection profile`;

    const connectionProfilesServerIcon = document.createElement('i');
    connectionProfilesServerIcon.id = 'extensionConnectionProfilesIcon';
    connectionProfilesServerIcon.className = 'fa-fw fa-solid fa-network-wired';

    connectionProfiles.append(connectionProfilesServerIcon, connectionProfilesSelect, connectionProfilesStatus, connectionProfilesIcon);
    sheld.insertBefore(connectionProfiles, chat);

    apiBlock.querySelectorAll('select').forEach(select => {
        select.addEventListener('input', () => updateStatusDebounced());
    });
}

function bindConnectionProfilesSelect() {
    waitUntilCondition(() => document.getElementById('connection_profiles') !== null).then(() => {
        const connectionProfilesMainSelect = /** @type {HTMLSelectElement} */ (document.getElementById('connection_profiles'));
        if (!connectionProfilesMainSelect) {
            return;
        }
        connectionProfilesSelect.addEventListener('change', async () => {
            connectionProfilesMainSelect.value = connectionProfilesSelect.value;
            connectionProfilesMainSelect.dispatchEvent(new Event('change'));
        });
        connectionProfilesMainSelect.addEventListener('change', async () => {
            connectionProfilesSelect.value = connectionProfilesMainSelect.value;
        });
        const observer = new MutationObserver(() => {
            connectionProfilesSelect.innerHTML = connectionProfilesMainSelect.innerHTML;
            connectionProfilesSelect.value = connectionProfilesMainSelect.value;
        });
        observer.observe(connectionProfilesMainSelect, { childList: true });
    });
}

async function populateSideBarForInChat() {
    const container = document.getElementById('extensionSideBarContainer');
    const loader = document.getElementById('extensionSideBarLoader');

    if (!loader || !container) {
        return;
    }
    loader.classList.add('displayNone');
    container.innerHTML = ''; // Clear it

    const messages = Array.from(document.querySelectorAll('#chat .mes'));
    messages.forEach(mes => {
        const isSystem = mes.getAttribute('is_system') === 'true';
        if (isSystem) return;

        const isUser = mes.getAttribute('is_user') === 'true';
        const author = isUser ? (mes.querySelector('.ch_name')?.textContent || 'User') : (mes.querySelector('.name')?.textContent || 'Character');
        const text = mes.querySelector('.mes_text')?.textContent;

        if (author && text) {
            const sideBarItem = document.createElement('div');
            sideBarItem.classList.add('sideBarItem');
            sideBarItem.addEventListener('click', () => {
                mes.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });

            const authorDiv = document.createElement('div');
            authorDiv.classList.add('chatName'); // reuse style
            authorDiv.textContent = author;

            const messageDiv = document.createElement('div');
            messageDiv.classList.add('chatMessage'); // reuse style
            messageDiv.textContent = text;

            sideBarItem.append(authorDiv, messageDiv);
            container.appendChild(sideBarItem);
        }
    });
}

async function onToggleSidebarClick() {
    const sidebar = document.getElementById('extensionSideBar');
    const toggle = document.getElementById('extensionTopBarToggleSidebar');

    if (!sidebar || !toggle) {
        console.warn(t`Sidebar or toggle button not found`);
        return;
    }

    toggle.classList.toggle('active');
    const alreadyVisible = sidebar.classList.contains('visible');

    const keyframes = [
        { opacity: alreadyVisible ? 1 : 0 },
        { opacity: alreadyVisible ? 0 : 1 },
    ];
    const options = {
        duration: animation_duration,
        easing: animation_easing,
    };

    const animation = sidebar.animate(keyframes, options);

    if (alreadyVisible) {
        await animation.finished;
        sidebar.classList.toggle('visible');
        await populateSideBar();
    } else {
        sidebar.classList.toggle('visible');
        await populateSideBar();
        await animation.finished;
    }

    savePanelsState();
}

async function populateSideBar() {
    const sidebar = document.getElementById('extensionSideBar');
    const loader = document.getElementById('extensionSideBarLoader');
    const container = document.getElementById('extensionSideBarContainer');

    if (!loader || !container || !sidebar) {
        return;
    }

    if (!sidebar.classList.contains('visible')) {
        container.innerHTML = '';
        return;
    }

    if (isChatInOperationMode) {
        await populateSideBarForInChat();
        return;
    }

    loader.classList.add('displayNone');
    const processId = uuidv4();
    const scrollTop = container.scrollTop;
    const prettify = x => {
        x.last_mes = timestampToMoment(x.last_mes);
        x.file_name = String(x.file_name).replace('.jsonl', '');
        return x;
    };
    container.dataset.processId = processId;
    const chatId = getCurrentChatId();
    const chats = (await getChatFiles()).map(prettify).sort((a, b) => sortMoments(a.last_mes, b.last_mes));

    if (container.dataset.processId !== processId) {
        console.log(t`Aborting populateSideBar due to process id mismatch`);
        return;
    }

    container.innerHTML = '';

    for (const chat of chats) {
        const sideBarItem = document.createElement('div');
        sideBarItem.classList.add('sideBarItem');

        sideBarItem.addEventListener('click', async () => {
            if (chat.file_name === chatId || sideBarItem.classList.contains('selected')) {
                return;
            }

            container.childNodes.forEach(x => x instanceof HTMLElement && x.classList.remove('selected'));
            sideBarItem.classList.add('selected');
            await openChatById(chat.file_name);
        });

        const isSelected = chat.file_name === chatId;
        sideBarItem.classList.toggle('selected', isSelected);

        const chatName = document.createElement('div');
        chatName.classList.add('chatName');
        chatName.textContent = chat.file_name;
        chatName.title = chat.file_name;

        const chatDate = document.createElement('small');
        chatDate.classList.add('chatDate');
        chatDate.textContent = chat.last_mes.format('l');
        chatDate.title = chat.last_mes.format('LL LT');

        const chatNameContainer = document.createElement('div');
        chatNameContainer.classList.add('chatNameContainer');
        chatNameContainer.append(chatName, chatDate);

        const chatMessage = document.createElement('div');
        chatMessage.classList.add('chatMessage');
        chatMessage.textContent = chat.mes;
        chatMessage.title = chat.mes;

        const chatStats = document.createElement('div');
        chatStats.classList.add('chatStats');

        const counterBlock = document.createElement('div');
        counterBlock.classList.add('counterBlock');

        const counterIcon = document.createElement('i');
        counterIcon.classList.add('fa-solid', 'fa-comment', 'fa-xs');

        const counterText = document.createElement('small');
        counterText.textContent = chat.chat_items;

        counterBlock.append(counterIcon, counterText);

        const fileSizeText = document.createElement('small');
        fileSizeText.classList.add('fileSize');
        fileSizeText.textContent = chat.file_size;

        chatStats.append(counterBlock, fileSizeText);

        const chatMessageContainer = document.createElement('div');
        chatMessageContainer.classList.add('chatMessageContainer');
        chatMessageContainer.append(chatMessage, chatStats);

        sideBarItem.append(chatNameContainer, chatMessageContainer);
        container.appendChild(sideBarItem);
    }

    container.scrollTop = scrollTop;

    /** @type {HTMLElement} */
    const selectedElement = container.querySelector('.selected');
    const isSelectedElementVisible = selectedElement && selectedElement.offsetTop >= container.scrollTop && selectedElement.offsetTop <= container.scrollTop + container.clientHeight;
    if (!isSelectedElementVisible) {
        container.scrollTop = selectedElement.offsetTop - container.clientHeight / 2;
    }

    loader.classList.add('displayNone');
}

async function openChatById(chatId) {
    const context = SillyTavern.getContext();

    if (!chatId) {
        return;
    }

    if (typeof openGroupChat === 'function' && context.groupId) {
        await openGroupChat(context.groupId, chatId);
        return;
    }

    if (typeof openCharacterChat === 'function' && context.characterId !== undefined) {
        await openCharacterChat(chatId);
        return;
    }
}

async function onChatNameChange() {
    const chatId = chatName.value;
    await openChatById(chatId);
}

async function onToggleConnectionProfilesClick() {
    const button = document.getElementById('extensionTopBarToggleConnectionProfiles');

    if (!button) {
        console.warn('Connection profiles button not found');
        return;
    }

    button.classList.toggle('active');
    connectionProfiles.classList.toggle('visible');
    savePanelsState();
    await onOnlineStatusChange();
}

async function onOnlineStatusChange() {
    if (!connectionProfiles.classList.contains('visible')) {
        return;
    }

    const connectionProfilesMainSelect = /** @type {HTMLSelectElement} */ (document.getElementById('connection_profiles'));
    if (connectionProfilesMainSelect) {
        connectionProfilesSelect.innerHTML = connectionProfilesMainSelect.innerHTML;
        connectionProfilesSelect.value = connectionProfilesMainSelect.value;
    } else {
        connectionProfilesSelect.classList.add('displayNone');
    }

    if (connectionProfilesStatus.nextElementSibling?.classList?.contains('icon-svg')) {
        connectionProfilesStatus.nextElementSibling.remove();
    }

    const { SlashCommandParser, onlineStatus, mainApi } = SillyTavern.getContext();

    if (onlineStatus === 'no_connection') {
        connectionProfilesStatus.classList.add('offline');
        connectionProfilesStatus.textContent = t`No connection...`;

        const nullIcon = new Image();
        nullIcon.classList.add('icon-svg', 'null-icon');
        connectionProfilesStatus.insertAdjacentElement('afterend', nullIcon);
        return;
    }

    async function getCurrentAPI() {
        let currentAPI = mainApi;
        try {
            const commandResult = await SlashCommandParser.commands['api'].callback({ quiet: 'true' }, '');
            if (commandResult) {
                currentAPI = commandResult;
            }
        } catch (error) {
            console.error(t`Failed to get current API`, error);
        }
        const fancyNameOption = apiBlock.querySelector(`select:not(#main_api) option[value="${currentAPI}"]`) ?? apiBlock.querySelector(`select#main_api option[value="${currentAPI}"]`);
        if (fancyNameOption) {
            // Remove text in parentheses or brackets
            return fancyNameOption.textContent.replace(/[[(].*[\])]/, '').trim();
        }
        return currentAPI;
    }

    async function getCurrentModel() {
        let currentModel = onlineStatus;
        try {
            const commandResult = await SlashCommandParser.commands['model'].callback({ quiet: 'true' }, '');
            if (commandResult && typeof commandResult === 'string') {
                currentModel = commandResult;
            }
        } catch (error) {
            console.error(t`Failed to get current model`, error);
        }
        const fancyNameOption = apiBlock.querySelector(`option[value="${currentModel}"]`);
        if (fancyNameOption) {
            return fancyNameOption.textContent.trim();
        }
        return currentModel;
    }

    const [currentAPI, currentModel] = await Promise.all([getCurrentAPI(), getCurrentModel()]);
    await addConnectionProfileIcon();
    connectionProfilesStatus.classList.remove('offline');
    connectionProfilesStatus.textContent = `${currentAPI} – ${currentModel}`;
}

async function addConnectionProfileIcon() {
    return new Promise((resolve) => {
        const modelName = getGeneratingApi();
        const image = new Image();
        image.classList.add('icon-svg');
        image.src = `/img/${modelName}.svg`;

        image.onload = async function () {
            connectionProfilesStatus.insertAdjacentElement('afterend', image);
            await SVGInject(image);
            resolve();
        };

        image.onerror = function () {
            resolve();
        };

        // Prevent infinite waiting
        setTimeout(() => resolve(), 500);
    });
}

function savePanelsState() {
    localStorage.setItem('topBarPanelsState', JSON.stringify({
        sidebarVisible: document.getElementById('extensionSideBar')?.classList.contains('visible'),
        connectionProfilesVisible: document.getElementById('extensionConnectionProfiles')?.classList.contains('visible'),
    }));
}

function restorePanelsState() {
    const state = JSON.parse(localStorage.getItem('topBarPanelsState'));

    if (!state) {
        return;
    }

    if (state.sidebarVisible) {
        document.getElementById('extensionTopBarToggleSidebar')?.click();
    }

    if (state.connectionProfilesVisible) {
        document.getElementById('extensionTopBarToggleConnectionProfiles')?.click();
    }
}

// Init extension on load
(async function () {
    addJQueryHighlight();
    patchSheldIfNeeded();
    addTopBar();
    addIcons();
    addSideBar();
    addConnectionProfiles();
    setChatName(getCurrentChatId());
    chatName.addEventListener('change', onChatNameChange);
    const setChatNameDebounced = debounce(() => setChatName(getCurrentChatId()), debounce_timeout.short);
    const populateSideBarDebounced = debounce(() => {
        if (document.getElementById('extensionSideBar')?.classList.contains('visible')) {
            populateSideBar();
        }
    }, debounce_timeout.short);
    const chatObserver = new MutationObserver(() => {
        if (isChatInOperationMode) {
            populateSideBarDebounced();
        }
    });
    chatObserver.observe(chat, { childList: true });
    for (const eventName of [event_types.CHAT_CHANGED, event_types.CHAT_DELETED, event_types.GROUP_CHAT_DELETED]) {
        eventSource.on(eventName, setChatNameDebounced);
    }
    eventSource.once(event_types.APP_READY, () => {
        bindConnectionProfilesSelect();
        restorePanelsState();
    });
    eventSource.on(event_types.ONLINE_STATUS_CHANGED, updateStatusDebounced);
})();
