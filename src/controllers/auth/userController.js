const User = require('../../models/auth');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

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
};

