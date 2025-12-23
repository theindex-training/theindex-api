import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class Ping {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  message: string;
}
