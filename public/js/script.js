// script.js - FIXED: Persist Collapsed State Với localStorage (Giữ Trạng Thái Sau Navigation)

(function() {
    // Synchronous script để apply theme và collapsed trước khi browser paint (ngăn flash)
    const savedTheme = localStorage.getItem('theme') || 'light';
    const savedCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    const body = document.body;
    const sidebar = document.getElementById('sidebar');
    
    if (savedTheme === 'dark') {
        body.classList.add('dark');
        if (sidebar) sidebar.classList.add('dark');
    }
    
    if (savedCollapsed && sidebar) {
        sidebar.classList.add('collapsed');
        const collapseIcon = document.getElementById('collapse-icon');
        if (collapseIcon) {
            collapseIcon.classList.remove('fa-angle-double-left');
            collapseIcon.classList.add('fa-angle-double-right');
        }
    }
})();

const sidebar = document.getElementById('sidebar');
const toggleTheme = document.getElementById('theme-toggle');
const collapseBtn = document.querySelector('.toggle-sidebar');
const collapseIcon = document.getElementById('collapse-icon');

// Apply saved theme khi load
const savedTheme = localStorage.getItem('theme') || 'light';
if (savedTheme === 'dark') {
    document.body.classList.add('dark');
    sidebar.classList.add('dark');
    if (toggleTheme) toggleTheme.checked = true;
}

// FIXED: Apply saved collapsed state
const savedCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
if (savedCollapsed) {
    sidebar.classList.add('collapsed');
    if (collapseIcon) {
        collapseIcon.classList.remove('fa-angle-double-left');
        collapseIcon.classList.add('fa-angle-double-right');
    }
    forceHideCollapsedText(); // Ẩn text nếu collapsed
}

if (toggleTheme) {
    toggleTheme.addEventListener('change', (e) => {
        const isDark = e.target.checked;
        if (isDark) {
            document.body.classList.add('dark');
            sidebar.classList.add('dark');
            localStorage.setItem('theme', 'dark');
        } else {
            document.body.classList.remove('dark');
            sidebar.classList.remove('dark');
            localStorage.setItem('theme', 'light');
        }
    });
}

if (collapseBtn) {
    collapseBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // Ngăn bubble
        const isCollapsed = sidebar.classList.contains('collapsed');
        sidebar.classList.toggle('collapsed');
        
        if (sidebar.classList.contains('collapsed')) {
            collapseIcon.classList.remove('fa-angle-double-left');
            collapseIcon.classList.add('fa-angle-double-right');
            localStorage.setItem('sidebarCollapsed', 'true');
            forceHideCollapsedText();
            startObserver();
        } else {
            collapseIcon.classList.remove('fa-angle-double-right');
            collapseIcon.classList.add('fa-angle-double-left');
            localStorage.setItem('sidebarCollapsed', 'false');
            restoreCollapsedText();
            stopObserver();
        }
    });
}

// FIXED: Function để force ẩn text trong collapsed
function forceHideCollapsedText() {
    const menuItems = sidebar.querySelectorAll('.menu-item');
    const toggleSpans = sidebar.querySelectorAll('.toggle-theme span, .toggle-sidebar span');
    
    menuItems.forEach(item => {
        const span = item.querySelector('span');
        if (span) {
            span.style.cssText = `
                display: none !important;
                opacity: 0 !important;
                width: 0 !important;
                overflow: hidden !important;
                visibility: hidden !important;
                pointer-events: none !important;
                transition: none !important;
            `;
        }
    });
    
    toggleSpans.forEach(span => {
        span.style.cssText = `
            display: none !important;
            opacity: 0 !important;
            width: 0 !important;
            overflow: hidden !important;
            visibility: hidden !important;
            pointer-events: none !important;
            transition: none !important;
        `;
    });
}

// FIXED: Function để restore text khi expand
function restoreCollapsedText() {
    const menuItems = sidebar.querySelectorAll('.menu-item');
    const toggleSpans = sidebar.querySelectorAll('.toggle-theme span, .toggle-sidebar span');
    
    menuItems.forEach(item => {
        const span = item.querySelector('span');
        if (span) {
            span.style.cssText = `
                display: inline !important;
                opacity: 1 !important;
                width: auto !important;
                overflow: visible !important;
                visibility: visible !important;
                pointer-events: auto !important;
                transition: opacity 0.2s ease, width 0.2s ease !important;
            `;
        }
    });
    
    toggleSpans.forEach(span => {
        span.style.cssText = `
            display: inline !important;
            opacity: 1 !important;
            width: auto !important;
            overflow: visible !important;
            visibility: visible !important;
            pointer-events: auto !important;
            transition: opacity 0.2s ease, width 0.2s ease !important;
        `;
    });
}

// FIXED: MutationObserver (giữ nguyên, chỉ giám sát thay đổi DOM, không block click)
let observer = null;
function startObserver() {
    if (observer) return;
    
    observer = new MutationObserver((mutations) => {
        if (sidebar.classList.contains('collapsed')) {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' || mutation.type === 'childList') {
                    const spans = sidebar.querySelectorAll('.menu-item span, .toggle-theme span, .toggle-sidebar span');
                    spans.forEach(span => {
                        if (span.style.display !== 'none') {
                            span.style.display = 'none';
                        }
                    });
                }
            });
        }
    });
    
    observer.observe(sidebar, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class']
    });
    
    // FIXED: Chỉ listener cho mouseenter (hover), không click để không block navigation
    sidebar.addEventListener('mouseenter', forcePreventTextShowHover, true);
}

function stopObserver() {
    if (observer) {
        observer.disconnect();
        observer = null;
    }
    
    sidebar.removeEventListener('mouseenter', forcePreventTextShowHover, true);
}

function forcePreventTextShowHover(e) {
    if (sidebar.classList.contains('collapsed')) {
        const target = e.target.closest('.menu-item, .toggle-theme, .toggle-sidebar');
        if (target) {
            const span = target.querySelector('span');
            if (span) {
                span.style.display = 'none'; // Force ẩn hover
            }
        }
        forceHideCollapsedText(); // Force toàn bộ
    }
}

// FIXED: Menu Navigation (Cho Phép Click Icon Navigate Mà Không Expand)
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', (e) => {
            // Xóa active cũ
            document.querySelectorAll('.menu-item').forEach(i => i.classList.remove('active'));
            // Set active mới
            e.target.classList.add('active');
            
            // FIXED: Chỉ preventDefault nếu href="#", nếu href thực thì cho phép navigation (không expand)
            if (e.target.tagName === 'A' && e.target.getAttribute('href') === '#') {
                e.preventDefault(); // Chỉ block placeholder
            }
            // Không add event để force ẩn text trên click - để CSS/Observer xử lý
        });
    });
});
