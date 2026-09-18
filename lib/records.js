/**
 * 测试记录内存 RingBuffer（SPEC §12.2）。
 *
 * 容量 50，新记录插入队首（records[0] 为最新），溢出丢弃最旧一条。
 * **仅进程内存**：不写盘、不落状态文件、不跨重启，插件卸载即释放。
 */

export const DEFAULT_MAX_RECORDS = 50;

export function createRing(capacity = DEFAULT_MAX_RECORDS) {
  const cap = Number.isFinite(capacity) && capacity > 0 ? Math.floor(capacity) : DEFAULT_MAX_RECORDS;
  /** @type {object[]} */
  let items = [];
  let seq = 0;

  return {
    get capacity() {
      return cap;
    },
    get count() {
      return items.length;
    },
    /** 追加一条记录到队首，溢出丢弃最旧一条。返回补好 id 的记录。 */
    push(record) {
      seq += 1;
      const withId = { id: `r-${record.startedAt}-${seq}`, ...record };
      items.unshift(withId);
      if (items.length > cap) items = items.slice(0, cap);
      return withId;
    },
    /** 快照副本：深拷贝，避免调用方改动内部状态（SPEC §12.2「并发」行）。 */
    snapshot() {
      return items.map((item) => structuredClone(item));
    },
    /**
     * 把队首（最新）那条记录的 `retry.isFinal` 补记为 true（SPEC §18.3）。
     *
     * 为什么需要它：有两条收尾路径（时长上限、等待期手动停止）在**写记录那一刻**
     * 无法预知自己就是最后一次尝试，故只能事后补记。补的是队首那条——调用方必须
     * 保证期间没有别的写入（本插件对 RingBuffer 的写入是单进程串行的）。
     * 只改这一个布尔值，不动记录的其它字段。
     *
     * @returns {boolean} 是否补记成功（缓冲区为空或无 retry 字段时返回 false，不抛异常）
     */
    markHeadFinal() {
      const head = items[0];
      if (head === null || head === undefined) return false;
      if (head.retry === null || head.retry === undefined || typeof head.retry !== "object") return false;
      head.retry.isFinal = true;
      return true;
    },
    /** 清空并返回清空条数。 */
    clear() {
      const cleared = items.length;
      items = [];
      return cleared;
    }
  };
}
