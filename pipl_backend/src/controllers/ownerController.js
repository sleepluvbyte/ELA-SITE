import { db } from '../config/database.js';

export async function getDashboard(req, res) {
  try {
    const totalClients = await db.query(
      'SELECT COUNT(*) FROM users WHERE role = $1',
      ['client']
    );

    const totalBeans = await db.query(
      'SELECT COALESCE(SUM(beans_count), 0) as total FROM users WHERE role = $1',
      ['client']
    );

    const totalRevenue = await db.query(
      'SELECT COALESCE(SUM(total_spent), 0) as total FROM users WHERE role = $1',
      ['client']
    );

    const recentTransactions = await db.query(
      `SELECT t.*, u.email, u.name 
       FROM transactions t 
       LEFT JOIN users u ON t.user_id = u.id 
       ORDER BY t.created_at DESC 
       LIMIT 50`
    );

    const topClients = await db.query(
      `SELECT name, email, beans_count, total_spent 
       FROM users 
       WHERE role = 'client' 
       ORDER BY total_spent DESC 
       LIMIT 10`
    );

    const monthlyStats = await db.query(
      `SELECT 
        DATE_TRUNC('month', created_at) as month,
        COUNT(*) as transactions,
        SUM(beans_change) as beans
       FROM transactions 
       WHERE created_at > NOW() - INTERVAL '6 months'
       GROUP BY month 
       ORDER BY month`
    );

    res.json({
      stats: {
        totalClients: parseInt(totalClients.rows[0].count),
        totalBeans: parseInt(totalBeans.rows[0].total),
        totalRevenue: parseFloat(totalRevenue.rows[0].total)
      },
      recentTransactions: recentTransactions.rows,
      topClients: topClients.rows,
      monthlyStats: monthlyStats.rows
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

export async function getAnalytics(req, res) {
  try {
    // Период приводим к целому положительному числу, чтобы исключить SQL-инъекцию
    let days = parseInt(req.query.period, 10);
    if (!Number.isInteger(days) || days <= 0) days = 30;
    if (days > 3650) days = 3650;

    const newClients = await db.query(
      `SELECT COUNT(*) FROM users 
       WHERE role = 'client' AND created_at > NOW() - make_interval(days => $1)`,
      [days]
    );

    const activeClients = await db.query(
      `SELECT COUNT(DISTINCT user_id) FROM transactions 
       WHERE created_at > NOW() - make_interval(days => $1)`,
      [days]
    );

    const beansDistributed = await db.query(
      `SELECT COALESCE(SUM(beans_change), 0) as total 
       FROM transactions 
       WHERE type = 'admin_add' AND created_at > NOW() - make_interval(days => $1)`,
      [days]
    );

    const rewardsRedeemed = await db.query(
      `SELECT COUNT(*) FROM transactions 
       WHERE type = 'reward_redeem' AND created_at > NOW() - make_interval(days => $1)`,
      [days]
    );

    res.json({
      newClients: parseInt(newClients.rows[0].count, 10),
      activeClients: parseInt(activeClients.rows[0].count, 10),
      beansDistributed: parseInt(beansDistributed.rows[0].total, 10),
      rewardsRedeemed: parseInt(rewardsRedeemed.rows[0].count, 10)
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

export async function getAllTransactions(req, res) {
  try {
    const { page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    const result = await db.query(
      `SELECT t.*, u.email, u.name, u2.name as admin_name 
       FROM transactions t 
       LEFT JOIN users u ON t.user_id = u.id 
       LEFT JOIN users u2 ON t.created_by = u2.id 
       ORDER BY t.created_at DESC 
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const total = await db.query('SELECT COUNT(*) FROM transactions');

    res.json({
      transactions: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(total.rows[0].count)
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

export async function exportData(req, res) {
  try {
    const clients = await db.query(
      'SELECT * FROM users WHERE role = $1 ORDER BY created_at',
      ['client']
    );

    const transactions = await db.query(
      'SELECT * FROM transactions ORDER BY created_at'
    );

    res.json({
      clients: clients.rows,
      transactions: transactions.rows,
      exportedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}