// Simple manual validation (replaces express-validator - saves ~4MB RAM)

function validate(req, rules) {
  const errors = [];

  for (const [field, rule] of Object.entries(rules)) {
    let value;
    if (field.startsWith('body.')) {
      const keys = field.replace('body.', '').split('.');
      value = req.body;
      for (const k of keys) value = value?.[k];
    } else if (field.startsWith('query.')) {
      value = req.query[field.replace('query.', '')];
    } else if (field.startsWith('param.')) {
      value = req.params[field.replace('param.', '')];
    }

    if (rule.required && (value === undefined || value === null || value === '')) {
      errors.push({ field, message: `${field} is required` });
      continue;
    }

    if (value !== undefined && value !== null && value !== '') {
      if (rule.isPhone && !/^\+?[0-9]{10,15}$/.test(String(value))) {
        errors.push({ field, message: 'Valid phone number required (10-15 digits)' });
      }
      if (rule.isInt && (isNaN(value) || !Number.isInteger(Number(value)))) {
        errors.push({ field, message: `${field} must be an integer` });
      }
      if (rule.isFloat && isNaN(Number(value))) {
        errors.push({ field, message: `${field} must be a number` });
      }
      if (rule.min !== undefined && Number(value) < rule.min) {
        errors.push({ field, message: `${field} must be >= ${rule.min}` });
      }
      if (rule.max !== undefined && Number(value) > rule.max) {
        errors.push({ field, message: `${field} must be <= ${rule.max}` });
      }
    }
  }

  return errors;
}

function handleValidation(rules) {
  return (req, res, next) => {
    const errors = validate(req, rules);
    if (errors.length > 0) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.map(e => ({ field: e.field, message: e.message }))
      });
    }
    next();
  };
}

// Pre-built rule sets
const rules = {
  register: {
    'body.email': { required: true },
    'body.name': { required: true }
  },
  login: {
    'body.email': { required: true }
  },
  donorSettings: {
    'body.max_receivers': { required: false, isInt: true, min: 1, max: 10 },
    'body.settings.data_limit_mb': { required: false, isInt: true, min: 100, max: 50000 },
    'body.settings.time_limit_min': { required: false, isInt: true, min: 5, max: 480 },
    'body.settings.daily_total_gb': { required: false, isInt: true, min: 1, max: 100 }
  },
  location: {
    'body.location.lat': { required: true, isFloat: true, min: -90, max: 90 },
    'body.location.lng': { required: true, isFloat: true, min: -180, max: 180 }
  },
  connection: {
    'body.donor_id': { required: true },
    'body.receiver_id': { required: true }
  },
  usageReport: {
    'body.connection_id': { required: true },
    'body.data_mb': { required: true, isFloat: true, min: 0 }
  }
};

module.exports = { handleValidation, validate, rules };
