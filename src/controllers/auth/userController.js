const User = require('../../models/auth');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// Must match the password rule in the frontend's RegisterForm.
const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/;

module.exports = {
    register: async function (req, res) {
        try {
            const { name, email, password, mobile } = req.body;

            // Validate input
            if (!name || !email || !password || !mobile) {
                return res.status(400).json({
                    statusCode: 400,
                    message: 'All fields are required'
                });
            }

            const existingUser = await User.findOne({ email });
            if (existingUser) {
                return res.status(409).json({
                    statusCode: 409,
                    message: 'Email already registered'
                });
            }

            const hashedPassword = await bcrypt.hash(password, 10);

            const user = new User({ name, email, password: hashedPassword, mobile });
            await user.save();
            return res.status(201).json({
                statusCode: 201,
                message: 'User registered successfully',
                data: {
                    id: user._id
                }
            });

        } catch (error) {
            return res.status(500).json({
                statusCode: 500,
                message: "Internal Server Error"
            });
        }
    },

    login: async function (req, res) {
        try {
            const { email, password } = req.body;

            // Validate input
            if (!email || !password) {
                return res.status(400).json({
                    statusCode: 400,
                    message: 'Email and password are required'
                });
            }

            const user = await User.findOne({ email });
            if (!user) {
                return res.status(401).json({
                    statusCode: 401,
                    message: 'Invalid credentials'
                });
            }

            // Compare password
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                return res.status(401).json({
                    statusCode: 401,
                    message: 'Invalid credentials'
                });
            }

            // Checked after the password so an unapproved email isn't revealed to someone without the password.
            if (user.isVerified !== true) {
                return res.status(403).json({
                    statusCode: 403,
                    message: 'Your account is not approved yet. Please contact the administrator.'
                });
            }

            // Generate JWT token with expiration
            const token = jwt.sign(
                { userId: user._id, email: user.email },
                process.env.JWT_SECRET,
                { expiresIn: '80d' } 
            );

            return res.status(200).json({
                statusCode: 200,
                message: 'Login successful',
                data: { token }
            });

        } catch (error) {
            return res.status(500).json({
                statusCode: 500,
                message: "Internal Server Error"
            });
        }
    },

    getProfile: async function (req, res) {
        try {
            const user = await User.findById(req.user.userId).select('name email').lean();
            if (!user) {
                return res.status(404).json({
                    statusCode: 404,
                    message: 'User not found'
                });
            }

            return res.status(200).json({
                statusCode: 200,
                message: 'Profile fetched successfully',
                data: { name: user.name, email: user.email }
            });

        } catch (error) {
            return res.status(500).json({
                statusCode: 500,
                message: "Internal Server Error"
            });
        }
    },

    changePassword: async function (req, res) {
        try {
            const { newPassword, confirmPassword } = req.body;

            if (!newPassword || !confirmPassword) {
                return res.status(400).json({
                    statusCode: 400,
                    message: 'New password and confirm password are required'
                });
            }

            if (newPassword !== confirmPassword) {
                return res.status(400).json({
                    statusCode: 400,
                    message: 'Passwords do not match'
                });
            }

            if (!PASSWORD_RULE.test(newPassword)) {
                return res.status(400).json({
                    statusCode: 400,
                    message: 'Password must be at least 8 characters and include uppercase, lowercase, number & special char'
                });
            }

            const hashedPassword = await bcrypt.hash(newPassword, 10);
            const user = await User.findByIdAndUpdate(req.user.userId, { password: hashedPassword });
            if (!user) {
                return res.status(404).json({
                    statusCode: 404,
                    message: 'User not found'
                });
            }

            return res.status(200).json({
                statusCode: 200,
                message: 'Password changed successfully'
            });

        } catch (error) {
            return res.status(500).json({
                statusCode: 500,
                message: "Internal Server Error"
            });
        }
    },
};

