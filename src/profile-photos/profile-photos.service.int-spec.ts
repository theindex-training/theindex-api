import { existsSync, mkdtempSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import sharp from 'sharp';
import { Fixtures, rejectionOf } from '../../test/int/fixtures';
import { setupIntegrationSuite } from '../../test/int/test-app';
import { AccountEntity } from '../accounts/account.entity';
import { Requester } from '../benchmarks/benchmark-owner';
import { BenchmarkResultsService } from '../benchmarks/benchmark-results.service';
import { BenchmarksModule } from '../benchmarks/benchmarks.module';
import { BenchmarksService } from '../benchmarks/benchmarks.service';
import { BenchmarkKind } from '../benchmarks/enums/benchmark-kind.enum';
import { AccountRole } from '../common/enums/account-role.enum';
import { AccountStatus } from '../common/enums/account-status.enum';
import { ExercisesService } from '../exercises/exercises.service';
import { MediaEntity } from '../media/media.entity';
import { MediaKind } from '../media/media-kind';
import { UploadedMediaFile } from '../media/media.service';
import { PhotoCrop } from '../media/profile-photo-processing';
import { MyProfileModule } from '../my-profile/my-profile.module';
import { AccountAdminService } from '../accounts/account-admin.service';
import { AccountsModule } from '../accounts/accounts.module';
import { GymLocationEntity } from '../gym-locations/gym-location.entity';
import {
  ScheduleBookingEntity,
  ScheduleSlotEntity,
  ScheduleWeekEntity,
} from '../schedules/schedule.entity';
import { SchedulesModule } from '../schedules/schedules.module';
import { SchedulesService } from '../schedules/schedules.service';
import { SubscriptionRenewalsService } from '../subscriptions/subscription-renewals.service';
import { TrainingTimeEntity } from '../training-times/training-time.entity';
import { TrainingTimesModule } from '../training-times/training-times.module';
import { WorkoutsModule } from '../workouts/workouts.module';
import { MyProfileService } from '../my-profile/my-profile.service';
import { TraineeProfilesModule } from '../trainee-profiles/trainee-profiles.module';
import { TraineeProfilesService } from '../trainee-profiles/trainee-profiles.service';
import { TrainerProfilesModule } from '../trainer-profiles/trainer-profiles.module';
import { TrainerProfilesService } from '../trainer-profiles/trainer-profiles.service';
import { ProfilePhotoEntity } from './profile-photo.entity';
import {
  NO_PHOTO_MESSAGE,
  PhotoOwner,
  ProfilePhotosService,
} from './profile-photos.service';

const PUBLIC_URL = 'https://media.example.test';

/** The whole picture of a square image, not turned. */
const WHOLE: PhotoCrop = { x: 0, y: 0, width: 1, height: 1, rotation: 0 };

/** A 400×200 JPEG: red on the left half, blue on the right, with a GPS-like EXIF tag. */
async function halves(): Promise<UploadedMediaFile> {
  const half = (color: string) =>
    sharp({
      create: { width: 200, height: 200, channels: 3, background: color },
    })
      .png()
      .toBuffer();
  const buffer = await sharp({
    create: { width: 400, height: 200, channels: 3, background: '#000' },
  })
    .composite([
      { input: await half('#ff0000'), left: 0, top: 0 },
      { input: await half('#0000ff'), left: 200, top: 0 },
    ])
    .jpeg({ quality: 95 })
    .withExifMerge({ IFD0: { Copyright: 'Somebody', Artist: 'Phone' } })
    .toBuffer();
  return { buffer, originalname: 'me.jpg', size: buffer.length };
}

/** The left square of `halves()` (red), and the right one (blue). */
const LEFT: PhotoCrop = { x: 0, y: 0, width: 0.5, height: 1, rotation: 0 };
const RIGHT: PhotoCrop = { x: 0.5, y: 0, width: 0.5, height: 1, rotation: 0 };

async function rgb(image: Buffer): Promise<number[]> {
  const { channels } = await sharp(image).stats();
  return channels.slice(0, 3).map((c) => Math.round(c.mean));
}

describe('ProfilePhotosService (integration)', () => {
  const env = { ...process.env };
  let storageDir: string;
  let privateDir: string;

  beforeAll(() => {
    storageDir = mkdtempSync(join(tmpdir(), 'photos-int-'));
    privateDir = mkdtempSync(join(tmpdir(), 'photos-int-private-'));
    process.env.MEDIA_STORAGE_DIR = storageDir;
    process.env.MEDIA_PUBLIC_URL = PUBLIC_URL;
    process.env.MEDIA_PRIVATE_STORAGE_DIR = privateDir;
  });

  afterAll(() => {
    process.env = env;
    rmSync(storageDir, { recursive: true, force: true });
    rmSync(privateDir, { recursive: true, force: true });
  });

  const fixtures = setupIntegrationSuite({
    extraImports: [
      MyProfileModule,
      BenchmarksModule,
      TraineeProfilesModule,
      TrainerProfilesModule,
      SchedulesModule,
      TrainingTimesModule,
      WorkoutsModule,
      AccountsModule,
    ],
  });

  beforeEach(() => {
    for (const dir of [storageDir, privateDir]) {
      for (const entry of readdirSync(dir)) {
        rmSync(join(dir, entry), { recursive: true, force: true });
      }
    }
  });

  const svc = (fx: Fixtures) => fx.moduleRef.get(ProfilePhotosService);
  const mediaRows = (fx: Fixtures) => fx.ds.getRepository(MediaEntity).find();
  const photoRows = (fx: Fixtures) =>
    fx.ds.getRepository(ProfilePhotoEntity).find();

  /** The files under a storage area's kind folder: `<id>/<file>`. */
  function filesIn(dir: string, folder: string): string[] {
    const root = join(dir, folder);
    if (!existsSync(root)) return [];
    return readdirSync(root).flatMap((id) =>
      readdirSync(join(root, id)).map((f) => `${id}/${f}`),
    );
  }
  const publicFiles = () => filesIn(storageDir, 'profile-photos');
  const privateFiles = () => filesIn(privateDir, 'profile-photo-originals');

  /** A trainee with an account (the uploader recorded on the media rows). */
  async function traineeWithAccount(fx: Fixtures, name = 'Ivan Petrov') {
    const profile = await fx.trainee(name);
    const account = await fx.ds.getRepository(AccountEntity).save({
      email: `${profile.id}@example.com`,
      passwordHash: null,
      role: AccountRole.TRAINEE,
      status: AccountStatus.ACTIVE,
      traineeProfileId: profile.id,
    });
    const owner: PhotoOwner = { traineeProfileId: profile.id };
    return { profile, account, owner };
  }

  describe('replace', () => {
    it('keeps the picture privately and publishes the chosen square at 128 and 512 px', async () => {
      const fx = fixtures();
      const { account, owner } = await traineeWithAccount(fx);

      const photo = await svc(fx).replace(
        owner,
        await halves(),
        RIGHT,
        account.id,
      );

      const media = await mediaRows(fx);
      const original = media.find(
        (m) => m.kind === MediaKind.PROFILE_PHOTO_ORIGINAL,
      )!;
      const published = media.find((m) => m.kind === MediaKind.PROFILE_PHOTO)!;
      expect(original).toMatchObject({
        kind: MediaKind.PROFILE_PHOTO_ORIGINAL,
        width: 400,
        height: 200,
        masterPath: `profile-photo-originals/${original.id}/original.jpg`,
        originalFilename: 'me.jpg',
        uploadedByAccountId: account.id,
      });
      expect(published).toMatchObject({
        kind: MediaKind.PROFILE_PHOTO,
        width: 512,
        height: 512,
        uploadedByAccountId: account.id,
      });
      expect(photo).toEqual({
        url: `${PUBLIC_URL}/profile-photos/${published.id}/s512.webp`,
        thumbnailUrl: `${PUBLIC_URL}/profile-photos/${published.id}/s128.webp`,
        crop: RIGHT,
        updatedAt: expect.any(Date) as Date,
      });

      // The picture is never public; the crops are.
      expect(privateFiles()).toEqual([`${original.id}/original.jpg`]);
      expect(publicFiles().sort()).toEqual([
        `${published.id}/s128.webp`,
        `${published.id}/s512.webp`,
      ]);
      expect(readdirSync(storageDir)).toEqual(['profile-photos']);

      // The right square is the blue one; the kept picture has no metadata.
      const [r, , b] = await rgb(
        await sharp(
          join(storageDir, 'profile-photos', published.id, 's512.webp'),
        ).toBuffer(),
      );
      expect(b).toBeGreaterThan(200);
      expect(r).toBeLessThan(50);
      const kept = await sharp(
        join(privateDir, original.masterPath),
      ).metadata();
      expect(kept.exif).toBeUndefined();

      expect(await photoRows(fx)).toEqual([
        expect.objectContaining({
          traineeProfileId: owner.traineeProfileId,
          trainerProfileId: null,
          originalMediaId: original.id,
          photoMediaId: published.id,
          crop: RIGHT,
        }),
      ]);
    });

    it('replaces an earlier photo: new URLs, and the earlier files and rows are gone', async () => {
      const fx = fixtures();
      const { account, owner } = await traineeWithAccount(fx);
      const first = await svc(fx).replace(
        owner,
        await halves(),
        LEFT,
        account.id,
      );

      const second = await svc(fx).replace(
        owner,
        await halves(),
        RIGHT,
        account.id,
      );

      expect(second.url).not.toBe(first.url);
      expect(await svc(fx).get(owner)).toEqual(second);
      const media = await mediaRows(fx);
      expect(media).toHaveLength(2);
      expect(await photoRows(fx)).toHaveLength(1);
      expect(publicFiles()).toHaveLength(2);
      expect(privateFiles()).toHaveLength(1);
      expect(
        publicFiles().every((f) => second.url.includes(f.split('/')[0])),
      ).toBe(true);
    });

    it('refuses a picture that is not an image, or a crop it can not use, keeping nothing (400)', async () => {
      const fx = fixtures();
      const { account, owner } = await traineeWithAccount(fx);
      const text = Buffer.from('not a picture');

      const notImage = await rejectionOf(
        svc(fx).replace(
          owner,
          { buffer: text, originalname: 'a.txt', size: text.length },
          WHOLE,
          account.id,
        ),
      );
      expect(notImage).toBeInstanceOf(BadRequestException);
      expect(notImage.message).toBe('The file is not a readable image');

      // The whole 400×200 picture is not square.
      const notSquare = await rejectionOf(
        svc(fx).replace(owner, await halves(), WHOLE, account.id),
      );
      expect(notSquare).toBeInstanceOf(BadRequestException);
      expect(notSquare.message).toBe('The selected area must be square');

      const missing = await rejectionOf(
        svc(fx).replace(owner, undefined, WHOLE, account.id),
      );
      expect(missing.message).toBe('file is required');

      expect(await mediaRows(fx)).toEqual([]);
      expect(await photoRows(fx)).toEqual([]);
      expect([...publicFiles(), ...privateFiles()]).toEqual([]);
    });

    it('keeps one photo per profile when two pictures are sent at once', async () => {
      const fx = fixtures();
      const { account, owner } = await traineeWithAccount(fx);
      const [a, b] = await Promise.all([halves(), halves()]);

      await Promise.all([
        svc(fx).replace(owner, a, LEFT, account.id),
        svc(fx).replace(owner, b, RIGHT, account.id),
      ]);

      const [row] = await photoRows(fx);
      expect(await photoRows(fx)).toHaveLength(1);
      const media = await mediaRows(fx);
      expect(media.map((m) => m.id).sort()).toEqual(
        [row.originalMediaId, row.photoMediaId].sort(),
      );
      expect(publicFiles()).toHaveLength(2);
      expect(privateFiles()).toHaveLength(1);
    });
  });

  describe('recrop', () => {
    it('crops the kept picture again, under new URLs, and removes the previous crop', async () => {
      const fx = fixtures();
      const { account, owner } = await traineeWithAccount(fx);
      const first = await svc(fx).replace(
        owner,
        await halves(),
        RIGHT,
        account.id,
      );
      const before = (await photoRows(fx))[0];

      // Turned upside down, red is on the right: the right square is red now.
      const turned: PhotoCrop = { ...RIGHT, rotation: 180 };
      const second = await svc(fx).recrop(owner, turned, account.id);

      expect(second.url).not.toBe(first.url);
      expect(second.crop).toEqual(turned);
      const after = (await photoRows(fx))[0];
      expect(after.originalMediaId).toBe(before.originalMediaId);
      expect(after.photoMediaId).not.toBe(before.photoMediaId);
      expect(publicFiles().sort()).toEqual([
        `${after.photoMediaId}/s128.webp`,
        `${after.photoMediaId}/s512.webp`,
      ]);
      const [r, , b] = await rgb(
        await sharp(
          join(storageDir, 'profile-photos', after.photoMediaId, 's128.webp'),
        ).toBuffer(),
      );
      expect(r).toBeGreaterThan(200);
      expect(b).toBeLessThan(50);
    });

    it('keeps the photo as it was when the new crop can not be used (400), and 404 without a photo', async () => {
      const fx = fixtures();
      const { account, owner } = await traineeWithAccount(fx);
      const none = await rejectionOf(svc(fx).recrop(owner, LEFT, account.id));
      expect(none).toBeInstanceOf(NotFoundException);
      expect(none.message).toBe(NO_PHOTO_MESSAGE);

      const photo = await svc(fx).replace(
        owner,
        await halves(),
        LEFT,
        account.id,
      );
      const tooSmall = await rejectionOf(
        svc(fx).recrop(
          owner,
          { x: 0, y: 0, width: 0.1, height: 0.2, rotation: 0 },
          account.id,
        ),
      );
      expect(tooSmall).toBeInstanceOf(BadRequestException);
      expect(tooSmall.message).toBe(
        'The selected area is too small: choose at least 64×64 pixels',
      );
      expect(await svc(fx).get(owner)).toEqual(photo);
      expect(publicFiles()).toHaveLength(2);
    });
  });

  describe('remove / openOriginal', () => {
    it('gives the owner the kept picture, and removing the photo deletes its rows and files', async () => {
      const fx = fixtures();
      const { account, owner } = await traineeWithAccount(fx);
      await svc(fx).replace(owner, await halves(), LEFT, account.id);

      const original = await svc(fx).openOriginal(owner);
      const chunks: Buffer[] = [];
      for await (const chunk of original.stream) chunks.push(chunk as Buffer);
      expect(original.contentType).toBe('image/jpeg');
      const meta = await sharp(Buffer.concat(chunks)).metadata();
      expect([meta.width, meta.height]).toEqual([400, 200]);

      await svc(fx).remove(owner);

      expect(await svc(fx).get(owner)).toBeNull();
      expect(await photoRows(fx)).toEqual([]);
      expect(await mediaRows(fx)).toEqual([]);
      expect([...publicFiles(), ...privateFiles()]).toEqual([]);
      for (const call of [
        () => svc(fx).remove(owner),
        () => svc(fx).openOriginal(owner),
      ]) {
        const error = await rejectionOf(call());
        expect(error).toBeInstanceOf(NotFoundException);
        expect(error.message).toBe(NO_PHOTO_MESSAGE);
      }
    });

    it('removes the files with a profile that is deleted for good', async () => {
      const fx = fixtures();
      const { account, owner, profile } = await traineeWithAccount(fx);
      await svc(fx).replace(owner, await halves(), LEFT, account.id);
      const trainer = await fx.trainer('Coach Ivo');
      await svc(fx).replace(
        { trainerProfileId: trainer.id },
        await halves(),
        RIGHT,
        account.id,
      );

      await fx.moduleRef.get(TraineeProfilesService).hardDelete(profile.id);
      expect(await photoRows(fx)).toHaveLength(1);
      expect(publicFiles()).toHaveLength(2);
      expect(privateFiles()).toHaveLength(1);

      await fx.moduleRef.get(TrainerProfilesService).hardDelete(trainer.id);
      expect(await photoRows(fx)).toEqual([]);
      expect(await mediaRows(fx)).toEqual([]);
      expect([...publicFiles(), ...privateFiles()]).toEqual([]);
    });
  });

  describe('concurrency', () => {
    /** Waits until `count` queries of this database wait for a lock. */
    async function lockWaiters(fx: Fixtures, count: number) {
      for (let tries = 0; tries < 200; tries++) {
        const [{ waiting }] = await fx.ds.query<{ waiting: number }[]>(
          `SELECT count(*)::int AS waiting FROM pg_stat_activity
           WHERE datname = current_database() AND wait_event_type = 'Lock'`,
        );
        if (waiting >= count) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(`Never saw ${count} queries waiting for a lock`);
    }

    it('removes the files of a photo saved while its profile was being deleted', async () => {
      const fx = fixtures();
      const { account, owner, profile } = await traineeWithAccount(fx);

      // Another transaction holds the profile's row: the upload, then the delete, queue behind it.
      const blocker = fx.ds.createQueryRunner();
      await blocker.connect();
      await blocker.startTransaction();
      await blocker.query(
        'SELECT id FROM trainee_profiles WHERE id = $1 FOR UPDATE',
        [profile.id],
      );
      const saving = svc(fx).replace(owner, await halves(), LEFT, account.id);
      await lockWaiters(fx, 1);
      const deleting = fx.moduleRef
        .get(TraineeProfilesService)
        .hardDelete(profile.id);
      await lockWaiters(fx, 2);
      await blocker.commitTransaction();
      await blocker.release();

      // The upload goes first and saves the photo; the delete then takes it, files included.
      await saving;
      await deleting;
      expect(await photoRows(fx)).toEqual([]);
      expect(await mediaRows(fx)).toEqual([]);
      expect([...publicFiles(), ...privateFiles()]).toEqual([]);
    });
  });

  describe('where photos are shown', () => {
    it('is part of "My details"', async () => {
      const fx = fixtures();
      const { account, owner } = await traineeWithAccount(fx);
      const myProfile = fx.moduleRef.get(MyProfileService);
      expect((await myProfile.get(account.id)).photo).toBeNull();

      const photo = await svc(fx).replace(
        owner,
        await halves(),
        LEFT,
        account.id,
      );

      expect(await myProfile.photoOwner(account.id)).toEqual(owner);
      expect((await myProfile.get(account.id)).photo).toEqual(photo);
      expect(
        (await myProfile.update(account.id, { instagram: 'ivan' })).photo,
      ).toEqual(photo);
    });

    it("puts the thumbnail on the trainees list, a trainee's details and attendance sessions, null without a photo", async () => {
      const fx = fixtures();
      const { account, owner, profile } = await traineeWithAccount(fx);
      const noPhoto = await fx.trainee('Mia');
      const photo = await svc(fx).replace(
        owner,
        await halves(),
        LEFT,
        account.id,
      );
      const trainees = fx.moduleRef.get(TraineeProfilesService);

      const list = await trainees.listWithPhotos({});
      expect(list.map((t) => [t.name, t.photoUrl])).toEqual([
        ['Ivan Petrov', photo.thumbnailUrl],
        ['Mia', null],
      ]);
      expect(await trainees.getWithPhoto(profile.id)).toMatchObject({
        id: profile.id,
        name: 'Ivan Petrov',
        photoUrl: photo.thumbnailUrl,
      });
      expect((await trainees.getWithPhoto(noPhoto.id)).photoUrl).toBeNull();

      const coach = await fx.trainer('Coach');
      const gym = await fx.location('Main');
      await fx.attend(profile.id, coach.id, gym.id, '2026-11-10T16:00:00Z');
      await fx.attend(noPhoto.id, coach.id, gym.id, '2026-11-10T16:00:00Z');
      const sessions = await fx.attendance.sessions({
        startDate: '2026-11-10',
        endDate: '2026-11-10',
      });
      expect(
        sessions.entities.trainees
          .map((t) => [t.name, t.photoUrl])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      ).toEqual([
        ['Ivan Petrov', photo.thumbnailUrl],
        ['Mia', null],
      ]);
    });

    it("puts the thumbnail on the trainers list, a trainer, renewals, a training's bookings and accounts, null without a photo", async () => {
      const fx = fixtures();
      const { account, owner, profile } = await traineeWithAccount(fx);
      const mia = await fx.trainee('Mia');
      const coach = await fx.trainer('Coach Ivo');
      const otherCoach = await fx.trainer('Zed');
      const mine = await svc(fx).replace(
        owner,
        await halves(),
        LEFT,
        account.id,
      );
      const coachs = await svc(fx).replace(
        { trainerProfileId: coach.id },
        await halves(),
        RIGHT,
        account.id,
      );

      // Trainers: the list and one trainer.
      const trainers = fx.moduleRef.get(TrainerProfilesService);
      expect(
        (await trainers.listWithPhotos()).map((t) => [t.name, t.photoUrl]),
      ).toEqual([
        ['Coach Ivo', coachs.thumbnailUrl],
        ['Zed', null],
      ]);
      expect((await trainers.getWithPhoto(coach.id)).photoUrl).toBe(
        coachs.thumbnailUrl,
      );
      expect((await trainers.getWithPhoto(otherCoach.id)).photoUrl).toBeNull();

      // Renewals: every row, by trainee.
      const plan = await fx.punchPlan(10, 5000);
      await fx.buy(profile.id, plan.id);
      await fx.buy(mia.id, plan.id);
      const renewals = await fx.moduleRef
        .get(SubscriptionRenewalsService)
        .overview();
      const rows = [...renewals.punch.exhausted, ...renewals.punch.active].map(
        (r) => [r.name, r.photoUrl],
      );
      expect(rows.sort()).toEqual([
        ['Ivan Petrov', mine.thumbnailUrl],
        ['Mia', null],
      ]);

      // A training's page: the trainees who booked it.
      const gym = await fx.ds
        .getRepository(GymLocationEntity)
        .save({ name: 'Main', isActive: true });
      const time = await fx.ds
        .getRepository(TrainingTimeEntity)
        .save({ startTime: '18:00', endTime: '19:00' });
      const week = await fx.ds
        .getRepository(ScheduleWeekEntity)
        .save({ gymId: gym.id, weekStart: '2026-11-16' });
      const slot = await fx.ds.getRepository(ScheduleSlotEntity).save({
        weekId: week.id,
        date: '2026-11-18',
        trainingTimeId: time.id,
        trainerId: coach.id,
      });
      await fx.ds.getRepository(ScheduleBookingEntity).save([
        { slotId: slot.id, traineeId: profile.id },
        { slotId: slot.id, traineeId: mia.id },
      ]);
      const training = await fx.moduleRef
        .get(SchedulesService)
        .training(slot.id);
      expect(training.trainees.map((t) => [t.name, t.photoUrl]).sort()).toEqual(
        [
          ['Ivan Petrov', mine.thumbnailUrl],
          ['Mia', null],
        ],
      );

      // Accounts: the connected profile's photo (trainee or trainer), none unconnected.
      const coachAccount = await fx.ds.getRepository(AccountEntity).save({
        email: 'coach@example.com',
        passwordHash: null,
        role: AccountRole.TRAINER,
        status: AccountStatus.ACTIVE,
        trainerProfileId: coach.id,
      });
      const loose = await fx.ds.getRepository(AccountEntity).save({
        email: 'new@example.com',
        passwordHash: null,
        role: AccountRole.TRAINEE,
        status: AccountStatus.ACTIVE,
      });
      const accounts = fx.moduleRef.get(AccountAdminService);
      const all = await accounts.list({ link: 'all' });
      const photoOf = (id: string) =>
        all.find((a) => a.id === id)?.profile?.photoUrl;
      expect(photoOf(account.id)).toBe(mine.thumbnailUrl);
      expect(photoOf(coachAccount.id)).toBe(coachs.thumbnailUrl);
      expect(all.find((a) => a.id === loose.id)?.profile).toBeNull();
      expect((await accounts.details(account.id)).profile?.photoUrl).toBe(
        mine.thumbnailUrl,
      );
    });

    it('puts the thumbnail of trainees and trainers on the leaderboards, null without a photo', async () => {
      const fx = fixtures();
      const { account, owner, profile } = await traineeWithAccount(fx);
      const coach = await fx.trainer('Coach Ivo');
      const noPhoto = await fx.trainee('Mia');
      const mine = await svc(fx).replace(
        owner,
        await halves(),
        LEFT,
        account.id,
      );
      const coachs = await svc(fx).replace(
        { trainerProfileId: coach.id },
        await halves(),
        RIGHT,
        account.id,
      );

      const deadlift = await fx.moduleRef
        .get(ExercisesService)
        .create({ name: 'Deadlift' });
      const lift = await fx.moduleRef.get(BenchmarksService).create({
        kind: BenchmarkKind.LIFT,
        name: 'Deadlift',
        exerciseIds: [deadlift.id],
      });
      const results = fx.moduleRef.get(BenchmarkResultsService);
      const asTrainee = (id: string): Requester => ({
        role: AccountRole.TRAINEE,
        owner: { traineeProfileId: id, trainerProfileId: null },
      });
      const log = (who: Requester, loadKg: number) =>
        results.create(who, {
          benchmarkId: lift.id,
          performedOn: '2026-01-10',
          loadKg,
        });
      await log(asTrainee(profile.id), 100);
      await log(
        {
          role: AccountRole.TRAINER,
          owner: { traineeProfileId: null, trainerProfileId: coach.id },
        },
        180,
      );
      await log(asTrainee(noPhoto.id), 60);

      const requester = asTrainee(profile.id);
      const board = await results.leaderboard(requester, lift.id);
      expect(board.rx.map((e) => [e.name, e.photoUrl])).toEqual([
        ['Coach Ivo', coachs.thumbnailUrl],
        ['Ivan Petrov', mine.thumbnailUrl],
        ['Mia', null],
      ]);

      const [card] = await results.overview(requester, BenchmarkKind.LIFT);
      expect(card.rx.map((e) => e.photoUrl)).toEqual([
        coachs.thumbnailUrl,
        mine.thumbnailUrl,
        null,
      ]);
      expect(card.myRx?.photoUrl).toBe(mine.thumbnailUrl);
    });
  });
});
