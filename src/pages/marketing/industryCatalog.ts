export type IndustryDetail = {
  slug: string;
  titleAr: string;
  titleEn: string;
  descriptionAr: string;
  descriptionEn: string;
  useCasesAr: string[];
  useCasesEn: string[];
  featuresAr: string[];
  featuresEn: string[];
  benefitsAr: string[];
  benefitsEn: string[];
};

export type IndustryGridItem = {
  slug: string;
  emoji: string;
  titleAr: string;
  titleEn: string;
};

/** Order matches RTL grid flow (first item appears on the right in RTL). */
export const INDUSTRY_GRID: IndustryGridItem[] = [
  { slug: 'salons-spa', emoji: '🧖‍♀️', titleAr: 'صالونات وسبا', titleEn: 'Salons & Spa' },
  { slug: 'home-services', emoji: '🏠', titleAr: 'خدمات منزلية', titleEn: 'Home services' },
  { slug: 'car-wash', emoji: '🚗', titleAr: 'مغاسل سيارات', titleEn: 'Car washes' },
  { slug: 'sports-clubs', emoji: '🏅', titleAr: 'أندية رياضية', titleEn: 'Sports clubs' },
  { slug: 'studios', emoji: '🎥', titleAr: 'استوديوهات', titleEn: 'Studios' },
  { slug: 'sea-trips', emoji: '⛵', titleAr: 'رحلات بحرية', titleEn: 'Sea trips' },
  { slug: 'veterinary', emoji: '🐾', titleAr: 'عيادات بيطرية', titleEn: 'Veterinary clinics' },
  { slug: 'training', emoji: '🎓', titleAr: 'تدريب وتعليم', titleEn: 'Training & education' },
  { slug: 'maintenance-cleaning', emoji: '🔧', titleAr: 'صيانة وتنظيف', titleEn: 'Maintenance & cleaning' },
  { slug: 'events', emoji: '🎪', titleAr: 'ترفيه وفعاليات', titleEn: 'Entertainment & events' },
  { slug: 'consulting', emoji: '💼', titleAr: 'استشارات', titleEn: 'Consulting' },
];

const DETAILS: Record<string, IndustryDetail> = {
  'salons-spa': {
    slug: 'salons-spa',
    titleAr: 'صالونات وسبا',
    titleEn: 'Salons & Spa',
    descriptionAr: 'إدارة مواعيد العملاء والموظفين والخدمات والباقات بسهولة.',
    descriptionEn: 'Manage appointments, team schedules, services, and packages in one flow.',
    useCasesAr: ['حجز حسب الموظف أو الخدمة', 'بيع باقات جلسات', 'متابعة ولاء العملاء'],
    useCasesEn: ['Employee or service-based booking', 'Session package sales', 'Retention campaigns'],
    featuresAr: ['الحجوزات', 'التسعير بالوسوم', 'برنامج الولاء', 'التقارير'],
    featuresEn: ['Bookings', 'Tag pricing', 'Loyalty', 'Reports'],
    benefitsAr: ['رفع الإشغال', 'تقليل التأخير', 'زيادة العودة المتكررة'],
    benefitsEn: ['Higher utilization', 'Less delay', 'More repeat visits'],
  },
  'home-services': {
    slug: 'home-services',
    titleAr: 'خدمات منزلية',
    titleEn: 'Home services',
    descriptionAr: 'تنظيم فرق ميدانية حسب المنطقة والوقت ونوع الخدمة.',
    descriptionEn: 'Run field teams by area, time, and service type.',
    useCasesAr: ['توزيع تلقائي للموظفين', 'إدارة مناطق التغطية', 'تأكيدات وتنبيهات قبل الزيارة'],
    useCasesEn: ['Auto assignment', 'Coverage zone controls', 'Visit reminders'],
    featuresAr: ['الجدولة الذكية', 'تطبيق الموظف', 'الإشعارات', 'إدارة الفروع'],
    featuresEn: ['Smart scheduling', 'Employee app', 'Notifications', 'Branch management'],
    benefitsAr: ['وصول أسرع', 'تقليل التعارضات', 'جودة تشغيل أعلى'],
    benefitsEn: ['Faster dispatch', 'Fewer conflicts', 'Stronger execution'],
  },
  'car-wash': {
    slug: 'car-wash',
    titleAr: 'مغاسل سيارات',
    titleEn: 'Car washes',
    descriptionAr: 'تشغيل الحضور أو الحجز المسبق وإدارة الطاقة التشغيلية لكل فترة.',
    descriptionEn: 'Handle walk-ins or bookings with clear capacity control.',
    useCasesAr: ['حجوزات زمنية', 'خدمات إضافية حسب الوسوم', 'متابعة الأداء اليومي'],
    useCasesEn: ['Time-slot bookings', 'Add-on pricing via tags', 'Daily performance visibility'],
    featuresAr: ['نظام الحجز', 'POS', 'التقارير', 'لوحة التحكم'],
    featuresEn: ['Booking system', 'POS', 'Reports', 'Dashboard'],
    benefitsAr: ['زيادة الاستغلال', 'تحكم أدق بالطوابير', 'مبيعات أعلى لكل زيارة'],
    benefitsEn: ['Better capacity usage', 'Queue control', 'Higher per-visit revenue'],
  },
  'sports-clubs': {
    slug: 'sports-clubs',
    titleAr: 'أندية رياضية',
    titleEn: 'Sports clubs',
    descriptionAr: 'إدارة اشتراكات العملاء والحصص والمدربين من نفس النظام.',
    descriptionEn: 'Manage subscriptions, classes, and trainer schedules together.',
    useCasesAr: ['فترات اشتراك', 'حصص جماعية', 'تنبيهات تجديد'],
    useCasesEn: ['Recurring plans', 'Class seat booking', 'Renewal reminders'],
    featuresAr: ['الاشتراكات', 'الحجوزات', 'التقارير', 'تطبيق الموظف'],
    featuresEn: ['Subscriptions', 'Bookings', 'Reports', 'Employee app'],
    benefitsAr: ['رفع الالتزام', 'تقليل التسرب', 'رؤية أوضح للإيرادات'],
    benefitsEn: ['Higher retention', 'Lower churn', 'Clear revenue view'],
  },
  studios: {
    slug: 'studios',
    titleAr: 'استوديوهات',
    titleEn: 'Studios',
    descriptionAr: 'تنظيم جلسات التصوير والتسجيل والإيجار حسب الوقت والمساحة والمعدات.',
    descriptionEn: 'Schedule shoots, recording blocks, and rentals by time, space, and gear.',
    useCasesAr: ['حجز بالساعة أو الباقة', 'تنسيق طاقم ومعدات', 'فواتير وتذكيرات'],
    useCasesEn: ['Hourly or package holds', 'Crew and gear coordination', 'Invoices and reminders'],
    featuresAr: ['الحجوزات', 'التسعير بالوسوم', 'التقارير', 'الإشعارات'],
    featuresEn: ['Bookings', 'Tag pricing', 'Reports', 'Notifications'],
    benefitsAr: ['تقليل الازدواجية', 'وضوح الجدول', 'تجربة عميل أنظف'],
    benefitsEn: ['Fewer double-books', 'Clear calendar', 'Cleaner client experience'],
  },
  'sea-trips': {
    slug: 'sea-trips',
    titleAr: 'رحلات بحرية',
    titleEn: 'Sea trips',
    descriptionAr: 'إدارة المقاعد والمواعيد والمدفوعات لرحلاتك وخروجك البحري.',
    descriptionEn: 'Manage seats, departures, and payments for trips and charters.',
    useCasesAr: ['حجز مقاعد محدودة', 'قوائم انتظار', 'تأكيدات قبل الرحلة'],
    useCasesEn: ['Limited seat holds', 'Waitlists', 'Pre-trip confirmations'],
    featuresAr: ['الحجوزات', 'الدفع', 'التقارير', 'الإشعارات'],
    featuresEn: ['Bookings', 'Payments', 'Reports', 'Notifications'],
    benefitsAr: ['امتلاء أوضح', 'تشغيل أقل ضغطًا', 'متابعة حضور أسهل'],
    benefitsEn: ['Clear fill rates', 'Less chaotic ops', 'Easier attendance tracking'],
  },
  veterinary: {
    slug: 'veterinary',
    titleAr: 'عيادات بيطرية',
    titleEn: 'Veterinary clinics',
    descriptionAr: 'تنظيم مواعيد الحيوانات الأليفة مع الأطباء والخدمات والمتابعة.',
    descriptionEn: 'Organize pet visits with vets, services, and follow-ups.',
    useCasesAr: ['حجز حسب الطبيب أو الخدمة', 'تذكيرات التطعيم', 'تقارير يومية'],
    useCasesEn: ['Vet or service-based slots', 'Vaccination reminders', 'Daily ops reports'],
    featuresAr: ['الحجوزات', 'الصلاحيات', 'التقارير', 'الإشعارات'],
    featuresEn: ['Bookings', 'Permissions', 'Reports', 'Notifications'],
    benefitsAr: ['تقليل الضغط الهاتفي', 'تجربة أوضح لأصحاب الحيوانات', 'تشغيل أدق'],
    benefitsEn: ['Less phone load', 'Clearer pet-owner journey', 'More reliable ops'],
  },
  training: {
    slug: 'training',
    titleAr: 'تدريب وتعليم',
    titleEn: 'Training & education',
    descriptionAr: 'تنظيم الدورات والحصص والحجوزات الفردية أو الجماعية.',
    descriptionEn: 'Coordinate courses, sessions, and individual/group bookings.',
    useCasesAr: ['حجز مقاعد', 'متابعة حضور', 'بيع باقات تعليمية'],
    useCasesEn: ['Seat reservations', 'Attendance follow-up', 'Educational bundles'],
    featuresAr: ['التذاكر/الحجوزات', 'الباقات', 'التقارير'],
    featuresEn: ['Booking/tickets', 'Packages', 'Reports'],
    benefitsAr: ['تنظيم أفضل', 'تقليل الإداري', 'تجربة متعلم أفضل'],
    benefitsEn: ['Structured delivery', 'Less admin load', 'Improved learner journey'],
  },
  'maintenance-cleaning': {
    slug: 'maintenance-cleaning',
    titleAr: 'صيانة وتنظيف',
    titleEn: 'Maintenance & cleaning',
    descriptionAr: 'جدولة فرق الصيانة والتنظيف والزيارات ومتابعة تنفيذ الطلبات.',
    descriptionEn: 'Schedule maintenance and cleaning crews with clear job tracking.',
    useCasesAr: ['توزيع حسب الفني أو الفريق', 'تتبع الطلبات', 'تقارير أداء'],
    useCasesEn: ['Assign by technician or team', 'Request tracking', 'Performance reports'],
    featuresAr: ['الحجوزات', 'تطبيق الموظف', 'لوحة تحكم', 'التقارير'],
    featuresEn: ['Bookings', 'Employee app', 'Dashboard', 'Reports'],
    benefitsAr: ['سرعة استجابة', 'تحكم ميداني أفضل', 'تقليل الفاقد التشغيلي'],
    benefitsEn: ['Faster response', 'Better field control', 'Lower operational waste'],
  },
  events: {
    slug: 'events',
    titleAr: 'ترفيه وفعاليات',
    titleEn: 'Entertainment & events',
    descriptionAr: 'إدارة الفعاليات من التسجيل وحتى إصدار التذاكر والتحقق.',
    descriptionEn: 'Manage event sales and attendance lifecycle from one place.',
    useCasesAr: ['بيع التذاكر', 'إدارة الجداول', 'تحليلات الحضور'],
    useCasesEn: ['Ticket sales', 'Schedule planning', 'Attendance analytics'],
    featuresAr: ['الفعاليات والتذاكر', 'الدفع', 'التقارير'],
    featuresEn: ['Events & tickets', 'Payments', 'Reports'],
    benefitsAr: ['إطلاق أسرع للفعالية', 'تنظيم أدق', 'وضوح مالي أعلى'],
    benefitsEn: ['Faster launch', 'Cleaner operations', 'Better financial clarity'],
  },
  consulting: {
    slug: 'consulting',
    titleAr: 'استشارات',
    titleEn: 'Consulting',
    descriptionAr: 'إدارة مواعيد العملاء بجداول مرنة ومتابعة دقيقة للحالات.',
    descriptionEn: 'Run appointments with flexible schedules and clear follow-up.',
    useCasesAr: ['جلسات فردية', 'تذكيرات تلقائية', 'فواتير منظمة'],
    useCasesEn: ['1:1 sessions', 'Automated reminders', 'Invoice-ready flow'],
    featuresAr: ['الحجوزات', 'الإشعارات', 'الفوترة', 'التقارير'],
    featuresEn: ['Bookings', 'Notifications', 'Invoicing', 'Reports'],
    benefitsAr: ['انضباط أعلى في المواعيد', 'رضا عميل أكبر', 'تشغيل أكثر سلاسة'],
    benefitsEn: ['Better punctuality', 'Higher satisfaction', 'Smoother operations'],
  },
};

export function getIndustryDetail(slug: string): IndustryDetail | undefined {
  return DETAILS[slug];
}

export function isValidIndustrySlug(slug: string): boolean {
  return Boolean(DETAILS[slug]);
}
