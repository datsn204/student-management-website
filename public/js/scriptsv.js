// scriptsv.js - Fixed version
document.addEventListener('DOMContentLoaded', function() {
    console.log('scriptsv.js loaded');

    // Kiểm tra đăng nhập và load thông tin sinh viên
    checkLoginAndLoadInfo();

    // Menu toggle for mobile
    const menuToggle = document.getElementById('menuToggle');
    const sidebar = document.getElementById('sidebar');

    if (menuToggle) {
        menuToggle.addEventListener('click', function() {
            sidebar.classList.toggle('collapsed');
        });
    }

    // User profile dropdown
    const userProfile = document.getElementById('userProfile');
    const dropdown = userProfile ? userProfile.querySelector('.dropdown-menu') : null;
    const chevron = document.getElementById('chevron');

    console.log('userProfile:', userProfile);
    console.log('dropdown:', dropdown);
    console.log('chevron:', chevron);

    if (userProfile && dropdown) {
        userProfile.addEventListener('click', function(e) {
            e.stopPropagation();
            e.preventDefault();
            
            const isShown = dropdown.classList.contains('show');
            console.log('Dropdown clicked. Current state:', isShown ? 'shown' : 'hidden');
            
            dropdown.classList.toggle('show');
            
            // Rotate chevron
            if (chevron) {
                chevron.style.transform = isShown ? 'rotate(0deg)' : 'rotate(180deg)';
                chevron.style.transition = 'transform 0.3s ease';
            }
            
            console.log('New state:', dropdown.classList.contains('show') ? 'shown' : 'hidden');
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', function(e) {
            if (!userProfile.contains(e.target)) {
                dropdown.classList.remove('show');
                if (chevron) {
                    chevron.style.transform = 'rotate(0deg)';
                    chevron.style.transition = 'transform 0.3s ease';
                }
            }
        });

        // Prevent dropdown from closing when clicking inside it
        dropdown.addEventListener('click', function(e) {
            e.stopPropagation();
        });

        // Handle logout
        const logout = document.getElementById('logout');
        if (logout) {
            logout.addEventListener('click', function(e) {
                e.preventDefault();
                if (confirm('Bạn có chắc chắn muốn đăng xuất?')) {
                    sessionStorage.removeItem('userInfo');
                    sessionStorage.removeItem('maTK');
                    sessionStorage.removeItem('vaiTro');
                    sessionStorage.removeItem('userRole');
                    sessionStorage.removeItem('sinhVienInfo');
                    window.location.href = '../index.html';
                }
            });
        }

        // Handle change password
        const changePassword = document.getElementById('changePassword');
        if (changePassword) {
            changePassword.addEventListener('click', function(e) {
                dropdown.classList.remove('show');
                if (chevron) {
                    chevron.style.transform = 'rotate(0deg)';
                }
            });
        }
    } else {
        console.error('User profile elements not found!');
        if (!userProfile) console.error('- userProfile not found');
        if (!dropdown) console.error('- dropdown not found');
    }

    // Notification hover animation
    const notification = document.querySelector('.notification');
    if (notification) {
        notification.addEventListener('mouseenter', function() {
            this.style.transform = 'scale(1.1) rotate(15deg)';
            this.style.transition = 'transform 0.3s ease';
        });
        notification.addEventListener('mouseleave', function() {
            this.style.transform = 'scale(1) rotate(0deg)';
            this.style.transition = 'transform 0.3s ease';
        });
    }

    // Smooth scroll for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });

    console.log('✓ scriptsv.js initialized successfully');
});

// Hàm kiểm tra đăng nhập và load thông tin
async function checkLoginAndLoadInfo() {
    const maTK = sessionStorage.getItem('maTK');
    const userRole = sessionStorage.getItem('userRole');

    console.log('=== DEBUG LOGIN INFO ===');
    console.log('maTK:', maTK);
    console.log('userRole:', userRole);

    if (!maTK || !userRole) {
        alert('Vui lòng đăng nhập!');
        window.location.href = '../index.html';
        return;
    }

    if (userRole.toLowerCase() !== 'sinhvien') {
        alert('Trang này chỉ dành cho sinh viên!');
        window.location.href = '../index.html';
        return;
    }

    try {
        const API_URL = `http://localhost:3000/api/students/by-account?maTK=${maTK}`;
        console.log('Calling API:', API_URL);

        const response = await fetch(API_URL);
        console.log('Response status:', response.status);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const sinhVien = await response.json();
        console.log('Student data:', sinhVien);

        if (sinhVien) {
            updateUserName(sinhVien.hoTen || 'Sinh viên');
            updateWelcomeMessage(sinhVien.hoTen || 'Sinh viên');
            sessionStorage.setItem('sinhVienInfo', JSON.stringify(sinhVien));
            console.log('✓ Loaded student info successfully');
        } else {
            console.error('Không tìm thấy thông tin sinh viên');
            updateUserName('Sinh viên');
        }
    } catch (error) {
        console.error('Lỗi khi load thông tin sinh viên:', error);
        alert(`Lỗi: ${error.message}\n\nVui lòng kiểm tra:\n1. Server đang chạy (http://localhost:3000)\n2. Tài khoản sinh viên đã được tạo trong database\n3. Console để xem chi tiết lỗi`);
        updateUserName('Sinh viên');
    }
}

// Hàm cập nhật tên người dùng
function updateUserName(name) {
    const userNameElement = document.querySelector('.user-name');
    if (userNameElement) {
        const chevron = userNameElement.querySelector('i');
        const chevronHTML = chevron ? chevron.outerHTML : '<i class="fas fa-chevron-down" id="chevron"></i>';
        userNameElement.innerHTML = `${name} ${chevronHTML}`;
    }
}

// Hàm cập nhật lời chào
function updateWelcomeMessage(name) {
    const welcomeTitle = document.querySelector('.welcome-title');
    if (welcomeTitle) {
        welcomeTitle.textContent = `Xin chào ${name}!`;
    }

    const welcomeText = document.querySelector('.welcome-section p');
    if (welcomeText) {
        welcomeText.textContent = `Chào mừng bạn đến với trang sinh viên. Dưới đây là một số thông tin nhanh và hành động phổ biến dành cho bạn.`;
    }
}

// Hàm helper để format date
function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('vi-VN');
}