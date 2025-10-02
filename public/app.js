(() => {
  const elements = {
    authShell: document.getElementById('authShell'),
    appShell: document.getElementById('appShell'),
    loginForm: document.getElementById('loginForm'),
    registerForm: document.getElementById('registerForm'),
    authTabs: document.querySelectorAll('.tab'),
    authMessage: document.getElementById('authMessage'),
    profileAvatar: document.getElementById('profileAvatar'),
    profileName: document.getElementById('profileName'),
    profileStatus: document.getElementById('profileStatus'),
    profileEditBtn: document.getElementById('profileEditBtn'),
    logoutBtn: document.getElementById('logoutBtn'),
    newGroupBtn: document.getElementById('newGroupBtn'),
    newDirectBtn: document.getElementById('newDirectBtn'),
    conversationFilter: document.getElementById('conversationFilter'),
    conversationList: document.getElementById('conversationList'),
    messenger: document.getElementById('messenger'),
    chatPlaceholder: document.getElementById('chatPlaceholder'),
    messageForm: document.getElementById('messageForm'),
    messageInput: document.getElementById('messageInput'),
    messageScroller: document.getElementById('messageScroller'),
    messageList: document.getElementById('messageList'),
    loadMoreBtn: document.getElementById('loadMoreBtn'),
    attachmentInput: document.getElementById('attachmentInput'),
    attachmentBar: document.getElementById('attachmentBar'),
    conversationAvatar: document.getElementById('conversationAvatar'),
    conversationTitle: document.getElementById('conversationTitle'),
    conversationMeta: document.getElementById('conversationMeta'),
    typingIndicator: document.getElementById('typingIndicator'),
    addMemberBtn: document.getElementById('addMemberBtn'),
    detailsToggleBtn: document.getElementById('detailsToggleBtn'),
    detailsCloseBtn: document.getElementById('detailsCloseBtn'),
    detailsPanel: document.getElementById('detailsPanel'),
    memberList: document.getElementById('memberList'),
    profileModal: document.getElementById('profileModal'),
    profileForm: document.getElementById('profileForm'),
    groupModal: document.getElementById('groupModal'),
    groupForm: document.getElementById('groupForm'),
    directModal: document.getElementById('directModal'),
    directForm: document.getElementById('directForm'),
    toast: document.getElementById('toast')
  };

  const state = {
    token: localStorage.getItem('pink:token') || null,
    user: null,
    socket: null,
    conversations: new Map(),
    conversationOrder: [],
    conversationMembers: new Map(),
    messages: new Map(),
    hasMoreHistory: new Map(),
    typing: new Map(),
    typingTimeouts: new Map(),
    presence: new Map(),
    pendingAttachments: [],
    currentConversationId: null,
    sendingMessage: false,
    filter: ''
  };

  const API_HEADERS = {
    'Content-Type': 'application/json'
  };

  function initials(text) {
    return (text || '?')
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase();
  }

  function formatTime(value) {
    if (!value) return '';
    const date = new Date(value);
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  function formatDateTime(value) {
    if (!value) return '';
    const date = new Date(value);
    return date.toLocaleString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: 'short'
    });
  }

  let toastTimer = null;
  function showToast(message, type = 'info') {
    if (!elements.toast) return;
    elements.toast.textContent = message;
    elements.toast.dataset.type = type;
    elements.toast.classList.remove('hidden');
    elements.toast.style.opacity = '1';
    elements.toast.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      elements.toast.style.opacity = '0';
      elements.toast.style.transform = 'translateX(-50%) translateY(10px)';
      setTimeout(() => elements.toast.classList.add('hidden'), 200);
    }, 3200);
  }

  function switchAuthForm(target) {
    elements.authTabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.target === target));
    elements.loginForm.classList.toggle('active', target === 'login');
    elements.registerForm.classList.toggle('active', target === 'register');
    elements.authMessage.textContent = '';
  }

  elements.authTabs.forEach((tab) => {
    tab.addEventListener('click', () => switchAuthForm(tab.dataset.target));
  });

  document.querySelectorAll('[data-switch]').forEach((node) => {
    node.addEventListener('click', () => switchAuthForm(node.dataset.switch));
  });

  function setAuthMessage(text, type = 'error') {
    elements.authMessage.textContent = text;
    elements.authMessage.style.color = type === 'error' ? '#d81b60' : '#2d0a1d';
  }

  function saveSession() {
    if (state.token) {
      localStorage.setItem('pink:token', state.token);
    }
    if (state.user) {
      localStorage.setItem('pink:user', JSON.stringify(state.user));
    }
  }

  function clearSession() {
    state.token = null;
    state.user = null;
    state.conversations.clear();
    state.conversationOrder = [];
    state.conversationMembers.clear();
    state.messages.clear();
    state.pendingAttachments = [];
    state.hasMoreHistory.clear();
    state.currentConversationId = null;
    if (state.socket) {
      state.socket.disconnect();
      state.socket = null;
    }
    localStorage.removeItem('pink:token');
    localStorage.removeItem('pink:user');
  }

  async function apiRequest(path, options = {}) {
    const headers = { ...API_HEADERS, ...(options.headers || {}) };
    if (state.token) {
      headers.Authorization = `Bearer ${state.token}`;
    }
    const response = await fetch(path, { ...options, headers });
    let data;
    try {
      data = await response.json();
    } catch (error) {
      data = {};
    }
    if (!response.ok) {
      const message = data?.message || '????????? ??????';
      throw new Error(message);
    }
    return data;
  }

  async function apiUpload(file) {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch('/api/uploads', {
      method: 'POST',
      body: formData,
      headers: state.token ? { Authorization: `Bearer ${state.token}` } : undefined
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.message || '?? ??????? ????????? ????');
    }
    return data.attachment;
  }

  function showAuth() {
    elements.authShell.classList.remove('hidden');
    elements.appShell.classList.add('hidden');
  }

  function showApp() {
    elements.authShell.classList.add('hidden');
    elements.appShell.classList.remove('hidden');
  }

  function setProfile(user) {
    state.user = user;
    elements.profileAvatar.textContent = initials(user.displayName || user.username);
    elements.profileAvatar.style.background = user.avatarColor || '#ff7aa9';
    elements.profileName.textContent = user.displayName || user.username;
    elements.profileStatus.textContent = user.statusMessage || '??? ???????';
  }

  function serializeForm(form) {
    const formData = new FormData(form);
    return Object.fromEntries(formData.entries());
  }

  elements.loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const payload = serializeForm(elements.loginForm);
      const data = await apiRequest('/api/login', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      state.token = data.token;
      setProfile(data.user);
      saveSession();
      await loadProfile();
      showApp();
    } catch (error) {
      setAuthMessage(error.message || '?? ??????? ?????');
    }
  });

  elements.registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const payload = serializeForm(elements.registerForm);
      const data = await apiRequest('/api/register', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      state.token = data.token;
      setProfile(data.user);
      saveSession();
      await loadProfile();
      showApp();
    } catch (error) {
      setAuthMessage(error.message || '?? ??????? ??????? ???????');
    }
  });

  elements.logoutBtn.addEventListener('click', () => {
    clearSession();
    showAuth();
  });

  function openModal(modal) {
    modal.classList.remove('hidden');
  }

  function closeModal(modal) {
    modal.classList.add('hidden');
  }

  document.querySelectorAll('.modal [data-close]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const modal = btn.closest('.modal');
      if (modal) closeModal(modal);
    });
  });

  [elements.profileModal, elements.groupModal, elements.directModal].forEach((modal) => {
    if (!modal) return;
    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        closeModal(modal);
      }
    });
  });

  elements.profileEditBtn.addEventListener('click', () => {
    if (!state.user) return;
    elements.profileForm.displayName.value = state.user.displayName || state.user.username;
    elements.profileForm.statusMessage.value = state.user.statusMessage || '';
    openModal(elements.profileModal);
  });

  elements.profileForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const payload = serializeForm(elements.profileForm);
      const data = await apiRequest('/api/profile', {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      setProfile(data.user);
      saveSession();
      closeModal(elements.profileModal);
      showToast('??????? ????????', 'success');
    } catch (error) {
      showToast(error.message || '?? ??????? ???????? ???????', 'error');
    }
  });

  elements.newGroupBtn.addEventListener('click', () => {
    elements.groupForm.reset();
    openModal(elements.groupModal);
  });

  elements.groupForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const payload = serializeForm(elements.groupForm);
      const members = (payload.members || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      const body = {
        title: payload.title,
        description: payload.description,
        isPrivate: Boolean(payload.isPrivate),
        members
      };
      const data = await apiRequest('/api/conversations', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      closeModal(elements.groupModal);
      showToast('?????? ???????', 'success');
      upsertConversations([data.conversation]);
      if (data.conversation?.id) {
        state.conversationMembers.set(data.conversation.id, data.conversation.members || []);
        openConversation(data.conversation.id);
      }
    } catch (error) {
      showToast(error.message || '?? ??????? ??????? ??????', 'error');
    }
  });

  elements.newDirectBtn.addEventListener('click', () => {
    elements.directForm.reset();
    openModal(elements.directModal);
  });

  elements.directForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const payload = serializeForm(elements.directForm);
      const data = await apiRequest('/api/conversations/direct', {
        method: 'POST',
        body: JSON.stringify({ username: payload.username })
      });
      closeModal(elements.directModal);
      upsertConversations([data.conversation]);
      state.conversationMembers.set(data.conversation.id, data.conversation.members || []);
      openConversation(data.conversation.id);
    } catch (error) {
      showToast(error.message || '?? ??????? ??????? ???', 'error');
    }
  });

  elements.conversationFilter.addEventListener('input', (event) => {
    state.filter = event.target.value.toLowerCase();
    renderConversationList();
  });

  function ensureConversationOrder() {
    const list = Array.from(state.conversations.values());
    list.sort((a, b) => {
      const timeA = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const timeB = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return timeB - timeA;
    });
    state.conversationOrder = list.map((item) => item.id);
  }

  function upsertConversations(conversations = []) {
    let changed = false;
    conversations.forEach((conversation) => {
      if (!conversation || !conversation.id) return;
      const existing = state.conversations.get(conversation.id) || {};
      const merged = { ...existing, ...conversation };
      state.conversations.set(conversation.id, merged);
      if (conversation.members) {
        state.conversationMembers.set(conversation.id, conversation.members);
      }
      changed = true;
    });
    if (changed) {
      ensureConversationOrder();
      renderConversationList();
      if (state.currentConversationId && state.conversations.has(state.currentConversationId)) {
        updateConversationHeader(state.currentConversationId);
      }
    }
  }

  function conversationDisplay(conversation) {
    const members = state.conversationMembers.get(conversation.id) || [];
    let title = conversation.title;
    let subtitle = '';
    let avatarColor = '#ff7aa9';
    let avatarText = initials(title);

    if (conversation.type === 'direct') {
      const other = members.find((member) => member.id !== state.user?.id);
      if (other) {
        title = other.displayName || other.username;
        subtitle = buildPresenceText(other);
        avatarColor = other.avatarColor || avatarColor;
        avatarText = initials(title);
      }
    } else {
      subtitle = `${members.length || 0} ??????????`;
    }

    if (conversation.lastMessage) {
      const author = conversation.lastMessage.user?.displayName || conversation.lastMessage.user?.username || '?';
      const fragment = (conversation.lastMessage.content || '').slice(0, 60);
      subtitle = `${author}: ${fragment || '[????????]'}`;
    }

    return { title, subtitle, avatarColor, avatarText };
  }

  function buildPresenceText(member) {
    const presence = state.presence.get(member.id);
    if (presence?.status === 'online') {
      return '? ????';
    }
    if (member.lastSeen || presence?.lastSeen) {
      return `??? ? ???? ${formatDateTime(presence?.lastSeen || member.lastSeen)}`;
    }
    return member.statusMessage || '?? ? ????';
  }

  function renderConversationList() {
    if (!elements.conversationList) return;
    elements.conversationList.innerHTML = '';

    const filter = state.filter;
    const fragment = document.createDocumentFragment();

    state.conversationOrder.forEach((conversationId) => {
      const conversation = state.conversations.get(conversationId);
      if (!conversation) return;
      const display = conversationDisplay(conversation);
      const haystack = `${display.title} ${display.subtitle}`.toLowerCase();
      if (filter && !haystack.includes(filter)) return;

      const item = document.createElement('div');
      item.className = 'conversation-item';
      if (state.currentConversationId === conversation.id) {
        item.classList.add('active');
      }
      item.dataset.conversationId = conversation.id;

      const avatar = document.createElement('div');
      avatar.className = 'avatar';
      avatar.textContent = display.avatarText;
      avatar.style.background = display.avatarColor;

      const meta = document.createElement('div');
      meta.className = 'conversation-meta';
      const titleEl = document.createElement('h4');
      titleEl.textContent = display.title;
      const subtitle = document.createElement('p');
      subtitle.textContent = display.subtitle;
      meta.append(titleEl, subtitle);

      const unread = Number(conversation.unreadCount || 0);
      let unreadBadge = null;
      if (unread > 0) {
        unreadBadge = document.createElement('span');
        unreadBadge.className = 'unread-badge';
        unreadBadge.textContent = unread > 99 ? '99+' : unread;
      }

      item.append(avatar, meta);
      if (unreadBadge) item.append(unreadBadge);
      fragment.append(item);
    });

    if (!fragment.children.length) {
      const placeholder = document.createElement('div');
      placeholder.className = 'helper';
      placeholder.textContent = state.filter ? '??? ???????????' : '?????? ????? ????. ???????? ????? ?????? ??? ??????? ?????? ???.';
      elements.conversationList.append(placeholder);
    } else {
      elements.conversationList.append(fragment);
    }
  }

  elements.conversationList.addEventListener('click', (event) => {
    const item = event.target.closest('.conversation-item');
    if (!item) return;
    const conversationId = Number(item.dataset.conversationId);
    openConversation(conversationId);
  });

  async function fetchConversationMembers(conversationId) {
    if (state.conversationMembers.has(conversationId)) {
      return state.conversationMembers.get(conversationId);
    }
    const data = await apiRequest(`/api/conversations/${conversationId}`);
    if (data?.conversation) {
      upsertConversations([data.conversation]);
      state.conversationMembers.set(conversationId, data.conversation.members || []);
      renderConversationList();
    }
    return state.conversationMembers.get(conversationId) || [];
  }

  async function loadMessages(conversationId, { before } = {}) {
    const params = new URLSearchParams();
    if (before) params.append('before', before);
    const limit = before ? 50 : 30;
    params.append('limit', limit.toString());
    const data = await apiRequest(`/api/conversations/${conversationId}/messages?${params.toString()}`);
    const list = data?.messages || [];
    const existing = state.messages.get(conversationId) || [];
    if (before) {
      state.messages.set(conversationId, [...list, ...existing]);
    } else {
      state.messages.set(conversationId, list);
    }
    state.hasMoreHistory.set(conversationId, list.length >= limit);
    return list;
  }

  function renderMembers(conversationId) {
    const members = state.conversationMembers.get(conversationId) || [];
    elements.memberList.innerHTML = '';
    const fragment = document.createDocumentFragment();
    members.forEach((member) => {
      const item = document.createElement('li');
      item.className = 'member-item';
      const avatar = document.createElement('div');
      avatar.className = 'avatar';
      avatar.textContent = initials(member.displayName || member.username);
      avatar.style.background = member.avatarColor || '#ff9ec1';

      const info = document.createElement('div');
      info.className = 'member-info';
      const name = document.createElement('span');
      name.textContent = member.displayName || member.username;
      const status = document.createElement('span');
      status.textContent = buildPresenceText(member);
      status.style.fontSize = '12px';
      status.style.color = 'rgba(77,45,75,0.6)';
      info.append(name, status);

      item.append(avatar, info);
      fragment.append(item);
    });
    elements.memberList.append(fragment);
  }

  function renderAttachmentBar() {
    if (!state.pendingAttachments.length) {
      elements.attachmentBar.classList.add('hidden');
      elements.attachmentBar.innerHTML = '';
      return;
    }
    elements.attachmentBar.classList.remove('hidden');
    elements.attachmentBar.innerHTML = '';
    state.pendingAttachments.forEach((file, index) => {
      const chip = document.createElement('div');
      chip.className = 'attachment-chip';
      chip.innerHTML = `<span>?? ${file.originalName || '????'}</span>`;
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = '?';
      removeBtn.addEventListener('click', () => {
        state.pendingAttachments.splice(index, 1);
        renderAttachmentBar();
      });
      chip.append(removeBtn);
      elements.attachmentBar.append(chip);
    });
  }

  async function openConversation(conversationId) {
    if (!state.conversations.has(conversationId)) return;
    if (state.currentConversationId === conversationId) return;

    state.currentConversationId = conversationId;
    elements.chatPlaceholder.classList.add('hidden');
    elements.messenger.classList.remove('hidden');

    elements.conversationList.querySelectorAll('.conversation-item').forEach((item) => {
      item.classList.toggle('active', Number(item.dataset.conversationId) === conversationId);
    });

    await fetchConversationMembers(conversationId);
    updateConversationHeader(conversationId);
    renderMembers(conversationId);

    const messages = await loadMessages(conversationId);
    renderMessages(conversationId);
    scrollMessagesToBottom(true);

    if (state.socket) {
      state.socket.emit('conversation:read', { conversationId });
    }
  }

  function updateConversationHeader(conversationId) {
    const conversation = state.conversations.get(conversationId);
    if (!conversation) return;
    const display = conversationDisplay(conversation);
    elements.conversationAvatar.textContent = display.avatarText;
    elements.conversationAvatar.style.background = display.avatarColor;
    elements.conversationTitle.textContent = display.title;

    const members = state.conversationMembers.get(conversationId) || [];
    const subtitle = conversation.type === 'direct'
      ? display.subtitle
      : `${members.length} ??????????`;
    elements.conversationMeta.textContent = subtitle;
  }

  function renderMessages(conversationId) {
    const messages = state.messages.get(conversationId) || [];
    elements.messageList.innerHTML = '';
    const fragment = document.createDocumentFragment();

    messages.forEach((message) => {
      fragment.append(renderMessageNode(message));
    });

    elements.messageList.append(fragment);
    const hasMore = state.hasMoreHistory.get(conversationId);
    elements.loadMoreBtn.classList.toggle('hidden', !hasMore);
  }

  function renderMessageNode(message) {
    const isOwn = message.user?.id === state.user?.id;
    const item = document.createElement('article');
    item.className = 'message';
    if (isOwn) item.classList.add('own');
    item.dataset.messageId = message.id;

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = initials(message.user?.displayName || message.user?.username);
    avatar.style.background = message.user?.avatarColor || '#ff7aa9';

    const bubble = document.createElement('div');
    bubble.className = 'bubble';

    const meta = document.createElement('div');
    meta.className = 'meta';
    const author = document.createElement('span');
    author.textContent = message.user?.displayName || message.user?.username || '?';
    const time = document.createElement('span');
    time.textContent = formatTime(message.createdAt);
    meta.append(author, time);
    bubble.append(meta);

    if (message.deletedAt) {
      const deleted = document.createElement('div');
      deleted.className = 'text';
      deleted.style.fontStyle = 'italic';
      deleted.style.opacity = '0.6';
      deleted.textContent = '????????? ???????';
      bubble.append(deleted);
    } else {
      if (message.content) {
        const text = document.createElement('div');
        text.className = 'text';
        text.innerHTML = escapeHtml(message.content).replace(/\n/g, '<br>');
        bubble.append(text);
      }
      if (message.attachments?.length) {
        const attachments = document.createElement('div');
        attachments.className = 'attachments';
        message.attachments.forEach((attachment) => {
          const img = document.createElement('img');
          img.src = attachment.url;
          img.alt = attachment.originalName || '????????';
          attachments.append(img);
        });
        bubble.append(attachments);
      }
    }

    if (message.reactions?.length) {
      const bar = document.createElement('div');
      bar.className = 'reaction-bar';
      message.reactions.forEach((reaction) => {
        const chip = document.createElement('span');
        chip.className = 'reaction-chip';
        if (reaction.reacted) chip.classList.add('active');
        chip.textContent = `${reaction.emoji} ${reaction.count}`;
        bar.append(chip);
      });
      bubble.append(bar);
    }

    const actions = document.createElement('div');
    actions.className = 'actions';
    const reactBtn = document.createElement('button');
    reactBtn.type = 'button';
    reactBtn.className = 'action-react';
    reactBtn.textContent = '?';
    actions.append(reactBtn);
    if (!message.deletedAt && isOwn) {
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'action-edit';
      editBtn.textContent = '????????';
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'action-delete';
      deleteBtn.textContent = '???????';
      actions.append(editBtn, deleteBtn);
    }
    bubble.append(actions);

    if (isOwn) {
      item.append(bubble, avatar);
    } else {
      item.append(avatar, bubble);
    }

    return item;
  }

  function escapeHtml(value) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function scrollMessagesToBottom(force = false) {
    if (!elements.messageScroller) return;
    if (force) {
      elements.messageScroller.scrollTop = elements.messageScroller.scrollHeight;
      return;
    }
    const threshold = elements.messageScroller.scrollHeight - elements.messageScroller.clientHeight - 120;
    if (elements.messageScroller.scrollTop >= threshold) {
      elements.messageScroller.scrollTop = elements.messageScroller.scrollHeight;
    }
  }

  elements.loadMoreBtn.addEventListener('click', async () => {
    const conversationId = state.currentConversationId;
    if (!conversationId) return;
    const list = state.messages.get(conversationId) || [];
    const oldest = list[0];
    if (!oldest) return;
    const previousScrollHeight = elements.messageScroller.scrollHeight;
    await loadMessages(conversationId, { before: oldest.id });
    renderMessages(conversationId);
    const diff = elements.messageScroller.scrollHeight - previousScrollHeight;
    elements.messageScroller.scrollTop = diff + elements.messageScroller.scrollTop;
  });

  elements.messageForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.sendingMessage) return;
    const conversationId = state.currentConversationId;
    if (!conversationId) return;
    const content = elements.messageInput.value.trim();
    const attachments = state.pendingAttachments.map((file) => file.id);
    if (!content && !attachments.length) return;

    state.sendingMessage = true;
    state.socket?.emit('typing:stop', { conversationId });

    const payload = { conversationId, content, attachments };
    state.socket?.emit('message:create', payload, (response) => {
      state.sendingMessage = false;
      if (!response?.ok) {
        showToast(response?.message || '?? ??????? ????????? ?????????', 'error');
        return;
      }
      elements.messageInput.value = '';
      state.pendingAttachments = [];
      renderAttachmentBar();
      scrollMessagesToBottom(true);
    });
  });

  elements.attachmentInput.addEventListener('change', async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    try {
      for (const file of files.slice(0, 3)) {
        const attachment = await apiUpload(file);
        state.pendingAttachments.push(attachment);
      }
      renderAttachmentBar();
    } catch (error) {
      showToast(error.message || '?? ??????? ????????? ????', 'error');
    } finally {
      elements.attachmentInput.value = '';
    }
  });

  elements.messageList.addEventListener('click', (event) => {
    const article = event.target.closest('.message');
    if (!article) return;
    const messageId = Number(article.dataset.messageId);
    const message = findMessageById(messageId);
    if (!message) return;

    if (event.target.classList.contains('action-edit')) {
      if (message.deletedAt) return;
      const updated = prompt('???????? ?????????', message.content || '');
      if (updated == null) return;
      apiRequest(`/api/messages/${messageId}`, {
        method: 'PUT',
        body: JSON.stringify({ content: updated })
      }).catch((error) => showToast(error.message || '?? ??????? ???????? ?????????', 'error'));
      return;
    }

    if (event.target.classList.contains('action-delete')) {
      if (!confirm('??????? ??????????')) return;
      apiRequest(`/api/messages/${messageId}`, { method: 'DELETE' }).catch((error) => {
        showToast(error.message || '?? ??????? ??????? ?????????', 'error');
      });
      return;
    }

    if (event.target.classList.contains('action-react')) {
      toggleReaction(message);
    }
  });

  function toggleReaction(message) {
    const emoji = '??';
    const myReaction = message.reactions?.find((reaction) => reaction.emoji === emoji && reaction.reacted);
    const action = myReaction ? 'remove' : 'add';
    const endpoint = `/api/messages/${message.id}/reactions`;
    apiRequest(endpoint, {
      method: 'POST',
      body: JSON.stringify({ emoji, action })
    }).catch((error) => showToast(error.message || '?? ??????? ????????? ???????', 'error'));
    state.socket?.emit('message:reaction', { messageId: message.id, emoji, action });
  }

  function findMessageById(messageId) {
    for (const list of state.messages.values()) {
      const message = list.find((item) => item.id === messageId);
      if (message) return message;
    }
    return null;
  }

  let typingTimer = null;
  elements.messageInput.addEventListener('input', () => {
    const conversationId = state.currentConversationId;
    if (!conversationId || !state.socket) return;
    clearTimeout(typingTimer);
    state.socket.emit('typing:start', { conversationId });
    typingTimer = setTimeout(() => {
      state.socket?.emit('typing:stop', { conversationId });
    }, 2500);
  });

  elements.messageInput.addEventListener('blur', () => {
    const conversationId = state.currentConversationId;
    if (conversationId) {
      state.socket?.emit('typing:stop', { conversationId });
    }
  });

  elements.addMemberBtn.addEventListener('click', async () => {
    const conversationId = state.currentConversationId;
    if (!conversationId) return;
    const username = prompt('??????? ????? ?????????');
    if (!username) return;
    try {
      await apiRequest(`/api/conversations/${conversationId}/members`, {
        method: 'POST',
        body: JSON.stringify({ username })
      });
      showToast('???????? ?????????', 'success');
    } catch (error) {
      showToast(error.message || '?? ??????? ?????????? ?????????', 'error');
    }
  });

  function toggleDetailsPanel(force) {
    if (force === true) {
      elements.detailsPanel.classList.remove('hidden');
      elements.detailsPanel.classList.add('visible');
      return;
    }
    if (force === false) {
      elements.detailsPanel.classList.add('hidden');
      elements.detailsPanel.classList.remove('visible');
      return;
    }
    const isHidden = elements.detailsPanel.classList.contains('hidden') && !elements.detailsPanel.classList.contains('visible');
    if (window.innerWidth <= 840) {
      elements.detailsPanel.classList.toggle('visible');
    } else {
      elements.detailsPanel.classList.toggle('hidden', !isHidden);
    }
  }

  elements.detailsToggleBtn.addEventListener('click', () => toggleDetailsPanel());
  elements.detailsCloseBtn.addEventListener('click', () => toggleDetailsPanel(false));

  function updateTypingIndicator(conversationId) {
    if (conversationId !== state.currentConversationId) return;
    const typingUsers = state.typing.get(conversationId) || new Set();
    if (!typingUsers.size) {
      elements.typingIndicator.classList.add('hidden');
      elements.typingIndicator.textContent = '';
      return;
    }
    const names = Array.from(typingUsers)
      .map((userId) => state.conversationMembers.get(conversationId)?.find((m) => m.id === userId))
      .filter(Boolean)
      .map((member) => member.displayName || member.username);
    elements.typingIndicator.textContent = `${names.join(', ')} ????????...`;
    elements.typingIndicator.classList.remove('hidden');
  }

  function setTyping(conversationId, userId, isTyping) {
    if (!state.typing.has(conversationId)) {
      state.typing.set(conversationId, new Set());
    }
    const set = state.typing.get(conversationId);
    if (isTyping) {
      set.add(userId);
      clearTimeout(state.typingTimeouts.get(userId));
      const timeout = setTimeout(() => {
        set.delete(userId);
        updateTypingIndicator(conversationId);
      }, 3000);
      state.typingTimeouts.set(userId, timeout);
    } else {
      set.delete(userId);
    }
    updateTypingIndicator(conversationId);
  }

  function addMessageToState(message) {
    const list = state.messages.get(message.conversationId) || [];
    const index = list.findIndex((item) => item.id === message.id);
    if (index >= 0) {
      list[index] = message;
    } else {
      list.push(message);
    }
    list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    state.messages.set(message.conversationId, list);
    if (state.currentConversationId === message.conversationId) {
      renderMessages(message.conversationId);
      scrollMessagesToBottom(message.user?.id === state.user?.id);
    }
  }

  function removeMessageFromState(message) {
    const list = state.messages.get(message.conversationId) || [];
    const index = list.findIndex((item) => item.id === message.id);
    if (index >= 0) {
      list[index] = message;
      state.messages.set(message.conversationId, list);
      if (state.currentConversationId === message.conversationId) {
        renderMessages(message.conversationId);
      }
    }
  }

  function applyPresenceUpdate({ userId, status, lastSeen }) {
    state.presence.set(userId, { status, lastSeen });
    if (state.currentConversationId) {
      updateConversationHeader(state.currentConversationId);
      renderMembers(state.currentConversationId);
    }
    renderConversationList();
  }

  function applyConversationList(list = []) {
    upsertConversations(list);
  }

  function applyConversationCreated(payload) {
    if (!payload?.conversation) return;
    const conversation = payload.conversation;
    upsertConversations([conversation]);
    if (conversation.members) {
      state.conversationMembers.set(conversation.id, conversation.members);
    }
  }

  function applyMemberUpdate({ conversationId, members }) {
    if (!conversationId) return;
    if (members) {
      state.conversationMembers.set(conversationId, members);
      if (state.currentConversationId === conversationId) {
        renderMembers(conversationId);
        updateConversationHeader(conversationId);
      }
    }
    ensureConversationOrder();
    renderConversationList();
  }

  function handleMemberRemoved({ conversationId }) {
    if (!conversationId) return;
    const isCurrentUser = !(state.conversationMembers.get(conversationId) || []).some((member) => member.id === state.user?.id);
    state.conversationMembers.delete(conversationId);
    state.messages.delete(conversationId);
    state.conversations.delete(conversationId);
    ensureConversationOrder();
    renderConversationList();
    if (state.currentConversationId === conversationId) {
      state.currentConversationId = null;
      elements.messenger.classList.add('hidden');
      elements.chatPlaceholder.classList.remove('hidden');
      showToast('?? ???????? ??????', 'info');
    }
    if (!isCurrentUser) {
      loadProfile();
    }
  }

  function setupSocket() {
    if (!state.token) return;
    const socket = io({
      auth: { token: state.token },
      transports: ['websocket', 'polling']
    });

    socket.on('connect_error', () => {
      showToast('?? ??????? ???????????? ? ???????', 'error');
    });

    socket.on('conversation:list', (list) => applyConversationList(list));
    socket.on('conversation:created', applyConversationCreated);
    socket.on('conversation:member-added', applyMemberUpdate);
    socket.on('conversation:member-removed', handleMemberRemoved);

    socket.on('message:created', (message) => addMessageToState(message));
    socket.on('message:updated', (message) => addMessageToState(message));
    socket.on('message:deleted', (message) => removeMessageFromState(message));

    socket.on('typing:update', ({ conversationId, userId, isTyping }) => {
      if (userId === state.user?.id) return;
      setTyping(conversationId, userId, isTyping);
    });

    socket.on('presence:update', applyPresenceUpdate);

    socket.on('profile:update', (user) => {
      setProfile(user);
      saveSession();
    });

    state.socket = socket;
  }

  async function loadProfile() {
    try {
      const data = await apiRequest('/api/profile');
      setProfile(data.user);
      upsertConversations(data.conversations || []);
      renderConversationList();
      if (!state.socket) {
        setupSocket();
      }
    } catch (error) {
      showToast(error.message || '?? ??????? ????????? ???????', 'error');
      clearSession();
      showAuth();
    }
  }

  async function bootstrap() {
    try {
      const savedUser = localStorage.getItem('pink:user');
      if (state.token && savedUser) {
        try {
          setProfile(JSON.parse(savedUser));
        } catch (error) {
          clearSession();
        }
      }
      if (state.token) {
        await loadProfile();
        showApp();
      } else {
        showAuth();
      }
    } catch (error) {
      showAuth();
    }
  }

  window.addEventListener('focus', () => {
    if (state.currentConversationId && state.socket) {
      state.socket.emit('conversation:read', { conversationId: state.currentConversationId });
    }
  });

  bootstrap();
})();
