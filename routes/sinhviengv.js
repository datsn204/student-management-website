// routes/sinhviengv.js
const express = require('express');
const router = express.Router();
const db = require('../config/db'); 

router.get('/students', async (req, res) => {
    const { maTK, maLop, maMH, _q: searchQuery, export: isExport, page = 1, limit = 25 } = req.query;
    
    if (!maTK) {
        return res.status(400).json({ message: 'Thiếu mã tài khoản giảng viên' });
    }

    try {
        console.log('Starting /students for maTK:', maTK, 'maLop:', maLop, 'maMH:', maMH, 'search:', searchQuery, 'export:', isExport, 'page:', page, 'limit:', limit);

        // Bước 1: Lấy maGV từ maTK
        const [gvRows] = await db.execute(
            'SELECT maGV FROM giangvien WHERE maTK = ?',
            [maTK]
        );
        if (gvRows.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy giảng viên' });
        }
        const maGV = gvRows[0].maGV;
        console.log('Found maGV:', maGV);

        let maLops = [];
        if (maLop) {
            // Kiểm tra quyền lớp
            const [checkLop] = await db.execute(
                'SELECT 1 FROM lop_mh_gv WHERE maGV = ? AND maLop = ?',
                [maGV, maLop]
            );
            if (checkLop.length === 0) {
                console.log('No permission for maLop:', maLop);
                return res.json({ data: [], total: 0, currentPage: 1, totalPages: 0 });
            }
            maLops = [maLop];
        } else {
            // Lấy tất cả lớp của GV
            const [lopRows] = await db.execute(
                'SELECT DISTINCT maLop FROM lop_mh_gv WHERE maGV = ?',
                [maGV]
            );
            if (lopRows.length === 0) {
                console.log('No classes for GV');
                return res.json({ data: [], total: 0, currentPage: 1, totalPages: 0 });
            }
            maLops = lopRows.map(row => row.maLop);
        }
        console.log('maLops:', maLops);

        // Bước 2: Xây dựng whereClause chung
        let whereClause = ' WHERE 1=1';
        let params = [];

        // Lọc theo lớp
        if (maLops.length > 0) {
            const placeholders = maLops.map(() => '?').join(',');
            whereClause += ` AND sv.maLop IN (${placeholders})`;
            params.push(...maLops);
        }

        // Lọc theo môn học
        if (maMH) {
            console.log('Checking permission for maMH:', maMH);
            let checkMHQuery = 'SELECT 1 FROM lop_mh_gv WHERE maGV = ? AND maMH = ?';
            let checkMHParams = [maGV, maMH];
            if (maLop) {
                checkMHQuery += ' AND maLop = ?';
                checkMHParams.push(maLop);
            }
            const [checkMH] = await db.execute(checkMHQuery, checkMHParams);
            if (checkMH.length === 0) {
                console.log('No permission for maMH:', maMH);
                return res.json({ data: [], total: 0, currentPage: 1, totalPages: 0 });
            }
            whereClause += ` AND sv.maLop IN (SELECT maLop FROM lop_mh_gv WHERE maMH = ? AND maGV = ?)`;
            params.push(maMH, maGV);
        }

        // Tìm kiếm
        if (searchQuery) {
            whereClause += ' AND (sv.maSV LIKE ? OR sv.hoTen LIKE ?)';
            params.push(`%${searchQuery}%`, `%${searchQuery}%`);
        }

        // Tính total count với query riêng (không dùng subquery để tránh lỗi syntax)
        let countQuery = `
            SELECT COUNT(DISTINCT sv.maSV) as total
            FROM sinhvien sv
            LEFT JOIN lophoc lh ON sv.maLop = lh.maLop
            LEFT JOIN khoa k ON sv.maKhoa = k.maKhoa
        `;
        countQuery += whereClause;
        const [countResult] = await db.execute(countQuery, params);
        const total = parseInt(countResult[0].total) || 0;

        // Tính pages
        const currentPageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 25;
        const totalPagesNum = Math.ceil(total / limitNum);

        // Nếu export=true, bỏ limit và trả full data
        if (isExport === 'true') {
            let SELECT_STUDENT_QUERY = `
                SELECT DISTINCT
                    sv.maSV, sv.hoTen, sv.ngaySinh, sv.gioiTinh, sv.email, sv.sdt, 
                    sv.maLop, lh.tenLop, 
                    sv.maKhoa, k.tenKhoa
                FROM sinhvien sv
                LEFT JOIN lophoc lh ON sv.maLop = lh.maLop
                LEFT JOIN khoa k ON sv.maKhoa = k.maKhoa
            `;
            let sql = SELECT_STUDENT_QUERY + whereClause + ' ORDER BY sv.maSV';
            const [rows] = await db.execute(sql, params);
            console.log('Export returned rows:', rows.length);
            return res.json(rows);
        }

        // Nếu total = 0, trả empty
        if (total === 0) {
            return res.json({ data: [], total, currentPage: currentPageNum, totalPages: totalPagesNum });
        }

        // Offset cho pagination
        const offset = (currentPageNum - 1) * limitNum;

        // Query data với limit/offset
        let SELECT_STUDENT_QUERY = `
            SELECT DISTINCT
                sv.maSV, sv.hoTen, sv.ngaySinh, sv.gioiTinh, sv.email, sv.sdt, 
                sv.maLop, lh.tenLop, 
                sv.maKhoa, k.tenKhoa
            FROM sinhvien sv
            LEFT JOIN lophoc lh ON sv.maLop = lh.maLop
            LEFT JOIN khoa k ON sv.maKhoa = k.maKhoa
        `;
        let sql = SELECT_STUDENT_QUERY + whereClause + ' ORDER BY sv.maSV LIMIT ? OFFSET ?';
        params.push(limitNum, offset);

        console.log('Final SQL:', sql);
        console.log('Final params:', params);

        const [rows] = await db.execute(sql, params);
        console.log('Returned rows:', rows.length);

        // Trả về object với metadata
        res.json({
            data: rows,
            total,
            currentPage: currentPageNum,
            totalPages: totalPagesNum
        });
    } catch (err) {
        console.error('LỖI /students:');
        console.error('Message:', err.message);
        console.error('Code:', err.errno || err.code);
        console.error('SQL State:', err.sqlState);
        console.error('SQL:', err.sql);
        res.status(500).json({ message: 'Lỗi máy chủ khi tải dữ liệu' });
    }
});

// Các route khác giữ nguyên
router.get('/classes', async (req, res) => {
    const { maTK, _q: query } = req.query;
    
    if (!maTK) {
        return res.status(400).json({ message: 'Thiếu mã tài khoản giảng viên' });
    }

    try {
        // Lấy maGV
        const [gvRows] = await db.execute(
            'SELECT maGV FROM giangvien WHERE maTK = ?',
            [maTK]
        );
        if (gvRows.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy giảng viên' });
        }
        const maGV = gvRows[0].maGV;

        let SELECT_CLASSES_QUERY = `
            SELECT 
                lmg.id,
                lh.maLop, lh.tenLop,
                mh.maMH, mh.tenMH,
                lh.maKhoa, k.tenKhoa
            FROM lop_mh_gv lmg
            LEFT JOIN lophoc lh ON lmg.maLop = lh.maLop
            LEFT JOIN monhoc mh ON lmg.maMH = mh.maMH
            LEFT JOIN khoa k ON lh.maKhoa = k.maKhoa
            WHERE lmg.maGV = ?
        `;

        let params = [maGV];
        if (query) {
            SELECT_CLASSES_QUERY += ' AND (lh.maLop LIKE ? OR lh.tenLop LIKE ? OR mh.maMH LIKE ? OR mh.tenMH LIKE ? OR k.tenKhoa LIKE ?)';
            params.push(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`);
        }
        SELECT_CLASSES_QUERY += ' ORDER BY lh.maLop, mh.maMH';

        const [rows] = await db.execute(SELECT_CLASSES_QUERY, params);
        res.json(rows);
    } catch (err) {
        console.error('LỖI /classes:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi tải dữ liệu' });
    }
});

router.get('/info', async (req, res) => {
    const { maTK } = req.query;
    if (!maTK) {
        return res.status(400).json({ message: 'Thiếu maTK' });
    }

    try {
        const [rows] = await db.execute(`
            SELECT gv.*, tk.matKhau, k.tenKhoa
            FROM giangvien gv
            LEFT JOIN taikhoan tk ON gv.maTK = tk.maTK
            LEFT JOIN khoa k ON gv.maKhoa = k.maKhoa
            WHERE gv.maTK = ?
        `, [maTK]);

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy thông tin giảng viên cho maTK này' });
        }

        res.json(rows[0]);
    } catch (err) {
        console.error('Lỗi khi lấy thông tin sinhviengv:', err.message, err.sql);
        res.status(500).json({ message: 'Lỗi máy chủ khi lấy thông tin' });
    }
});
module.exports = router;