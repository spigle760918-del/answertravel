# GEOFlow upstream record

The AnswerTravel product shell follows the GEOFlow design system and public admin-shell interaction patterns from:

- Repository: https://github.com/yaojingang/GEOFlow
- Fixed commit: `abcc638887dd35f508a59815f01ed42bc4415a09`
- License: AGPL-3.0-only
- Verified upstream tree SHA: `abcc638887dd35f508a59815f01ed42bc4415a09`
- Verified shell sources: `resources/css/app.css` (blob `34b1f0cacef65c9b2c4cc09790b9309895e4f588`), `resources/css/admin-ui-v3-stability.css`, `resources/views/components/admin/v3/sidebar.blade.php`, `resources/views/components/admin/v3/topbar.blade.php`, and `resources/views/admin/layouts/app.blade.php`.

AnswerTravel changes the business routes and data contracts, and deliberately excludes GEOFlow CMS, content-factory, distribution, analytics, lead, and site-administration features. The AnswerTravel backend remains an independent TypeScript/PostgreSQL/Redis service.

The corresponding AGPL source and full license text must remain available to remote users before any public conveyance of this frontend. This local implementation is still in pre-production Gate E and has not been publicly deployed.
