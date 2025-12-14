const Company = require('../../models/company');

module.exports = {
    // Add a new company
    addCompany: async (req, res) => {
        try {
            const { name, platforms } = req.body;

            // Validate input
            if (!name || !platforms || !Array.isArray(platforms) || platforms.length === 0) {
                return res.status(400).json({
                    statusCode: 400,
                    message: 'Company name and at least one platform are required',
                });
            }

            const company = new Company({ name, platforms, user: req.user.userId });
            await company.save();

            return res.status(201).json({
                statusCode: 201,
                message: 'Company added successfully',
                data: company,
            });

        } catch (err) {
            return res.status(500).json({
                statusCode: 500,
                message: 'Internal Server Error',
            });
        }
    },

    // List all companies for the authenticated user
    listCompanies: async (req, res) => {
        try {
            const companies = await Company.find({ user: req.user.userId });

            return res.status(200).json({
                statusCode: 200,
                message: 'Companies retrieved successfully',
                data: companies,
            });

        } catch (err) {
            return res.status(500).json({
                statusCode: 500,
                message: 'Internal Server Error',
            });
        }
    },

    // Update a company by ID
    updateCompany: async (req, res) => {
        try {
            const { id } = req.params;
            const { name, platforms } = req.body;

            // Validate input
            if (!name && (!platforms || !Array.isArray(platforms))) {
                return res.status(400).json({
                    statusCode: 400,
                    message: 'At least one field (name or platforms) is required to update',
                });
            }

            const company = await Company.findOneAndUpdate(
                { _id: id, user: req.user.userId },
                { name, platforms },
                { new: true, runValidators: true }
            );

            if (!company) {
                return res.status(404).json({
                    statusCode: 404,
                    message: 'Company not found',
                });
            }

            return res.status(200).json({
                statusCode: 200,
                message: 'Company updated successfully',
                data: company,
            });

        } catch (err) {
            return res.status(500).json({
                statusCode: 500,
                message: 'Internal Server Error',
            });
        }
    },

    // Delete a company by ID
    deleteCompany: async (req, res) => {
        try {
            const { id } = req.params;

            const company = await Company.findOneAndDelete({ _id: id, user: req.user.userId });

            if (!company) {
                return res.status(404).json({
                    statusCode: 404,
                    message: 'Company not found',
                });
            }

            return res.status(200).json({
                statusCode: 200,
                message: 'Company deleted successfully',
            });

        } catch (err) {
            return res.status(500).json({
                statusCode: 500,
                message: 'Internal Server Error',
            });
        }
    },
};