const express = require('express');
const router = express.Router();
const expenseController = require('../controllers/expenseController');
const auth = require('../middleware/auth');

const upload = require('../middleware/uploadMiddleware');

router.get('/:trip_id', auth, expenseController.getExpenses);
router.get('/', auth, expenseController.getExpenses);
router.post('/', auth, upload.single('receipt'), expenseController.createExpense);
router.put('/:id', auth, upload.single('receipt'), expenseController.updateExpense);
router.patch('/:id/settle', auth, expenseController.settleExpenseShare);
router.get('/:trip_id/balances', auth, expenseController.getBalances);
router.delete('/:id', auth, expenseController.deleteExpense);


module.exports = router;
