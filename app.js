import { marked } from 'marked';
import DOMPurify from 'dompurify';

let currentProject = null;
let currentUser = null;
let comments = [];
let selectedTipAmount = 0;
let cursor = null;
let currentView = 'all';

async function init() {
    try {
        currentProject = await window.websim.getCurrentProject();
        currentUser = await window.websim.getCurrentUser();
        
        document.getElementById('projectTitle').textContent = currentProject.title;
        updateUserInfo();
        await loadComments();
        
        setupEventListeners();
        setupRealTimeUpdates();
    } catch (error) {
        console.error('Initialization error:', error);
    }
}

function updateUserInfo() {
    const avatar = document.getElementById('userAvatar');
    const username = document.getElementById('username');
    
    if (currentUser.avatar_url) {
        avatar.style.backgroundImage = `url(${currentUser.avatar_url})`;
        avatar.style.backgroundSize = 'cover';
        avatar.textContent = '';
    } else {
        avatar.textContent = currentUser.username.charAt(0).toUpperCase();
    }
    
    username.textContent = currentUser.username;
}

function setupEventListeners() {
    // Tip selection
    document.querySelectorAll('.tip-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tip-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            
            const amount = e.target.dataset.amount;
            if (amount === 'custom') {
                selectedTipAmount = 'custom';
                document.getElementById('customTip').classList.remove('hidden');
            } else {
                selectedTipAmount = parseInt(amount) || 0;
                document.getElementById('customTip').classList.add('hidden');
                updatePostButton();
            }
        });
    });

    // Custom tip amount
    document.getElementById('customAmount').addEventListener('input', (e) => {
        selectedTipAmount = parseInt(e.target.value) || 0;
        updatePostButton();
    });

    // Character counter
    const commentInput = document.getElementById('commentInput');
    commentInput.addEventListener('input', (e) => {
        document.getElementById('charCount').textContent = e.target.value.length;
    });

    // Post comment
    document.getElementById('postBtn').addEventListener('click', postComment);

    // View toggle
    document.querySelectorAll('.toggle-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentView = e.target.dataset.view;
            cursor = null;
            loadComments();
        });
    });

    // Load more
    document.getElementById('loadMoreBtn').addEventListener('click', () => loadComments(true));

    // Handle auth modal
    window.closeAuthModal = () => {
        document.getElementById('authModal').classList.add('hidden');
    };
}

function updatePostButton() {
    const btn = document.getElementById('postBtn');
    const btnTip = document.getElementById('btnTip');
    
    if (selectedTipAmount > 0) {
        btnTip.textContent = `+ ${selectedTipAmount} Credits`;
        btnTip.style.display = 'inline';
    } else {
        btnTip.style.display = 'none';
    }
}

async function postComment() {
    const content = document.getElementById('commentInput').value.trim();
    if (!content) return;

    let tipAmount = 0;
    if (selectedTipAmount === 'custom') {
        tipAmount = parseInt(document.getElementById('customAmount').value) || 0;
    } else {
        tipAmount = selectedTipAmount;
    }

    try {
        const result = await window.websim.postComment({
            content: content,
            credits: tipAmount
        });

        if (result.error) {
            if (result.error.includes('interacted')) {
                document.getElementById('authModal').classList.remove('hidden');
            }
            return;
        }

        document.getElementById('commentInput').value = '';
        document.getElementById('charCount').textContent = '0';
        
        // Reset tip selection
        selectedTipAmount = 0;
        document.querySelectorAll('.tip-btn')[0].click();
        
    } catch (error) {
        console.error('Error posting comment:', error);
    }
}

async function loadComments(loadMore = false) {
    if (!loadMore) {
        comments = [];
        document.getElementById('commentsContainer').innerHTML = '<div class="loading">Loading comments...</div>';
    }

    const params = new URLSearchParams({
        first: '20'
    });

    if (currentView === 'tips') {
        params.append('only_tips', 'true');
    }

    if (cursor && loadMore) {
        params.append('after', cursor);
    }

    try {
        const response = await fetch(`/api/v1/projects/${currentProject.id}/comments?${params}`);
        const data = await response.json();
        
        if (!loadMore) {
            comments = [];
        }
        
        comments.push(...data.comments.data);
        
        renderComments();
        updateStats();
        
        cursor = data.comments.has_next_page ? data.comments.data[data.comments.data.length - 1]?.comment?.id : null;
        document.getElementById('loadMoreBtn').style.display = cursor ? 'block' : 'none';
        
    } catch (error) {
        console.error('Error loading comments:', error);
    }
}

function renderComments() {
    const container = document.getElementById('commentsContainer');
    
    if (comments.length === 0) {
        container.innerHTML = '<div class="loading">No comments yet. Be the first to comment!</div>';
        return;
    }

    container.innerHTML = comments.map(comment => {
        const c = comment.comment;
        const isTip = c.card_data?.type === 'tip_comment';
        const tipAmount = c.card_data?.credits_spent;
        
        return `
            <div class="comment">
                <div class="comment-header">
                    <div class="comment-author">
                        <div class="avatar">
                            ${c.author.display_name ? c.author.display_name.charAt(0).toUpperCase() : c.author.username.charAt(0).toUpperCase()}
                        </div>
                        <div class="author-info">
                            <span class="author-name">${c.author.display_name || c.author.username}</span>
                            <span class="comment-time">${new Date(c.created_at).toLocaleDateString()}</span>
                        </div>
                    </div>
                    ${isTip ? `<span class="tip-badge">+${tipAmount} Credits</span>` : ''}
                </div>
                <div class="comment-content">
                    ${DOMPurify.sanitize(marked.parse(c.raw_content))}
                </div>
            </div>
        `;
    }).join('');
}

function updateStats() {
    const tipComments = comments.filter(c => c.comment.card_data?.type === 'tip_comment');
    const totalCredits = tipComments.reduce((sum, c) => sum + (c.comment.card_data?.credits_spent || 0), 0);
    
    document.getElementById('commentCount').textContent = comments.length;
    document.getElementById('tipCount').textContent = tipComments.length;
    document.getElementById('totalCredits').textContent = totalCredits;
}

function setupRealTimeUpdates() {
    window.websim.addEventListener('comment:created', (data) => {
        if (data.comment.parent_comment_id) return; // Skip replies for now
        
        comments.unshift({ comment: data.comment });
        renderComments();
        updateStats();
    });
}

// Initialize the app
init();

