using System.Collections.Generic;

namespace SankeyMoney;

public class ScheduleDto
{
    public string Type { get; set; } = "recurring"; // recurring | oneoff | monthly
    public string? Start { get; set; }
    public string? End { get; set; }
    public int? DayOfMonth { get; set; }
    public string? Date { get; set; }
    public string? Month { get; set; }
}

public class ItemDto
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Kind { get; set; } = "expense"; // income | expense | loan
    public string? Category { get; set; }
    public double Amount { get; set; }
    public bool Enabled { get; set; } = true;
    public string? Note { get; set; }
    public ScheduleDto Schedule { get; set; } = new();
}

public class LedgerDto
{
    public long Id { get; set; }
    public string Name { get; set; } = "";
    public string PeriodStart { get; set; } = "";
    public string PeriodEnd { get; set; } = "";
    public int ItemCount { get; set; }
    public List<ItemDto>? Items { get; set; }
}
