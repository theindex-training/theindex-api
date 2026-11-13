/**
 * A week created from the template starts as a DRAFT that only staff see, so they can review and
 * change it before trainees do. Publishing it (once, for good) shows it to trainees and opens
 * booking. Weeks created before drafts existed are PUBLISHED (the column's default).
 */
export enum ScheduleWeekStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
}
