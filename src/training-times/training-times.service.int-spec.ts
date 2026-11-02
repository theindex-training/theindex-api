import { randomUUID } from 'crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Fixtures, rejectionOf } from '../../test/int/fixtures';
import { setupIntegrationSuite } from '../../test/int/test-app';
import { TrainingTimeEntity } from './training-time.entity';
import { TrainingTimesModule } from './training-times.module';
import { TrainingTimesService } from './training-times.service';

const RANGE_ERROR = 'endTime must be after startTime';

describe('TrainingTimesService (integration)', () => {
  const fixtures = setupIntegrationSuite({
    extraImports: [TrainingTimesModule],
  });

  const svc = (fx: Fixtures) => fx.moduleRef.get(TrainingTimesService);
  const repo = (fx: Fixtures) => fx.ds.getRepository(TrainingTimeEntity);
  const row = (fx: Fixtures, id: string) => repo(fx).findOneByOrFail({ id });

  async function expectBadRequest(promise: Promise<unknown>, message: string) {
    const err = await rejectionOf(promise);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toBe(message);
  }

  async function expectNotFound(promise: Promise<unknown>) {
    const err = await rejectionOf(promise);
    expect(err).toBeInstanceOf(NotFoundException);
    expect(err.message).toBe('Training time not found');
  }

  describe('create', () => {
    it('TT-01 a valid range is stored', async () => {
      const fx = fixtures();

      const created = await svc(fx).create({
        startTime: '09:00',
        endTime: '10:30',
      });

      expect(await row(fx, created.id)).toMatchObject({
        startTime: '09:00:00',
        endTime: '10:30:00',
      });
    });

    it('TT-01 endTime equal to or before startTime -> 400, nothing stored', async () => {
      const fx = fixtures();

      await expectBadRequest(
        svc(fx).create({ startTime: '09:00', endTime: '09:00' }),
        RANGE_ERROR,
      );
      await expectBadRequest(
        svc(fx).create({ startTime: '09:00', endTime: '08:59' }),
        RANGE_ERROR,
      );
      // Minutes are compared, not just hours.
      await expectBadRequest(
        svc(fx).create({ startTime: '09:30', endTime: '09:15' }),
        RANGE_ERROR,
      );
      // A slot that crosses midnight is rejected too.
      await expectBadRequest(
        svc(fx).create({ startTime: '23:00', endTime: '00:30' }),
        RANGE_ERROR,
      );

      expect(await repo(fx).count()).toBe(0);
    });

    it('TT-01 one minute is enough: 09:00-09:01 is accepted', async () => {
      const fx = fixtures();

      const created = await svc(fx).create({
        startTime: '09:00',
        endTime: '09:01',
      });

      expect((await row(fx, created.id)).endTime).toBe('09:01:00');
    });
  });

  describe('update', () => {
    it('TT-02 only endTime, before the stored start -> 400; row unchanged', async () => {
      const fx = fixtures();
      const tt = await svc(fx).create({ startTime: '18:00', endTime: '19:00' });

      await expectBadRequest(
        svc(fx).update(tt.id, { endTime: '17:30' }),
        RANGE_ERROR,
      );
      await expectBadRequest(
        svc(fx).update(tt.id, { endTime: '18:00' }),
        RANGE_ERROR,
      );

      expect(await row(fx, tt.id)).toMatchObject({
        startTime: '18:00:00',
        endTime: '19:00:00',
      });
    });

    it('TT-02 only startTime, after the stored end -> 400; row unchanged', async () => {
      const fx = fixtures();
      const tt = await svc(fx).create({ startTime: '18:00', endTime: '19:00' });

      await expectBadRequest(
        svc(fx).update(tt.id, { startTime: '19:30' }),
        RANGE_ERROR,
      );

      expect(await row(fx, tt.id)).toMatchObject({
        startTime: '18:00:00',
        endTime: '19:00:00',
      });
    });

    it('TT-02 a valid partial update changes only the sent field', async () => {
      const fx = fixtures();
      const tt = await svc(fx).create({ startTime: '18:00', endTime: '19:00' });

      await svc(fx).update(tt.id, { endTime: '19:30' });
      expect(await row(fx, tt.id)).toMatchObject({
        startTime: '18:00:00',
        endTime: '19:30:00',
      });

      await svc(fx).update(tt.id, { startTime: '17:45' });
      expect(await row(fx, tt.id)).toMatchObject({
        startTime: '17:45:00',
        endTime: '19:30:00',
      });
    });

    it('TT-02 both fields are validated together: moving the whole slot later works', async () => {
      const fx = fixtures();
      const tt = await svc(fx).create({ startTime: '08:00', endTime: '09:00' });

      // startTime alone (20:00) would be after the stored end, but the pair is valid.
      await svc(fx).update(tt.id, { startTime: '20:00', endTime: '21:00' });

      expect(await row(fx, tt.id)).toMatchObject({
        startTime: '20:00:00',
        endTime: '21:00:00',
      });
    });

    it('TT-03 unknown id -> 404', async () => {
      const fx = fixtures();

      await expectNotFound(svc(fx).update(randomUUID(), { endTime: '10:00' }));
    });
  });

  describe('list / edit / delete', () => {
    it('TT-03 list is ordered by startTime ASC; overlapping slots are allowed', async () => {
      const fx = fixtures();
      const late = await svc(fx).create({
        startTime: '18:00',
        endTime: '19:00',
      });
      const early = await svc(fx).create({
        startTime: '07:00',
        endTime: '08:00',
      });
      const overlap = await svc(fx).create({
        startTime: '18:30',
        endTime: '19:30',
      });
      const noon = await svc(fx).create({
        startTime: '12:00',
        endTime: '13:00',
      });

      const list = await svc(fx).list();

      expect(list.map((t) => t.id)).toEqual([
        early.id,
        noon.id,
        late.id,
        overlap.id,
      ]);
    });

    it('TT-03 edit returns the stored slot; unknown id -> 404', async () => {
      const fx = fixtures();
      const tt = await svc(fx).create({ startTime: '09:00', endTime: '10:00' });

      expect(await svc(fx).edit(tt.id)).toMatchObject({
        id: tt.id,
        startTime: '09:00:00',
        endTime: '10:00:00',
      });
      await expectNotFound(svc(fx).edit(randomUUID()));
    });

    it('TT-03 delete is a hard delete -> { deleted: true }; only that row goes; unknown id -> 404', async () => {
      const fx = fixtures();
      const a = await svc(fx).create({ startTime: '09:00', endTime: '10:00' });
      const b = await svc(fx).create({ startTime: '10:00', endTime: '11:00' });

      expect(await svc(fx).delete(a.id)).toEqual({ deleted: true });

      const remaining = await repo(fx).find();
      expect(remaining.map((t) => t.id)).toEqual([b.id]);
      await expectNotFound(svc(fx).delete(a.id));
      await expectNotFound(svc(fx).delete(randomUUID()));
    });
  });

  describe('response format', () => {
    it('TT-04 create returns the input strings (HH:mm), reads return HH:mm:ss', async () => {
      const fx = fixtures();

      const created = await svc(fx).create({
        startTime: '09:00',
        endTime: '10:30',
      });
      expect(created.startTime).toBe('09:00');
      expect(created.endTime).toBe('10:30');

      const [listed] = await svc(fx).list();
      expect(listed.startTime).toBe('09:00:00');
      expect(listed.endTime).toBe('10:30:00');

      const read = await svc(fx).edit(created.id);
      expect(read.startTime).toBe('09:00:00');
      expect(read.endTime).toBe('10:30:00');
    });

    // CHARACTERIZATION: possibly unintended
    it('TT-04 update returns the sent field as HH:mm and the untouched one as HH:mm:ss', async () => {
      const fx = fixtures();
      const tt = await svc(fx).create({ startTime: '09:00', endTime: '10:30' });

      const updated = await svc(fx).update(tt.id, { endTime: '11:00' });

      expect(updated.startTime).toBe('09:00:00');
      expect(updated.endTime).toBe('11:00');
    });
  });
});
